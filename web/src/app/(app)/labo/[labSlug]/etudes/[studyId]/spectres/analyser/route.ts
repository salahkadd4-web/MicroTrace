import { SPECTRAL_MODEL_UNAVAILABLE } from "@/lib/engine-messages";
import { SPECTRAL_MAX_BYTES } from "@/lib/spectral";
import { prisma } from "@/server/db";
import { EngineUnavailableError } from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { requireLab } from "@/server/lab-context";
import { parseMultipart } from "@/server/multipart";
import { analyzeSpectrum } from "@/server/spectral";
import { assertWritable } from "@/server/studies";

export const runtime = "nodejs";

/** Marge pour l'enveloppe multipart (frontières, en-têtes, champs). */
const MULTIPART_OVERHEAD = 1024 * 1024;
const MAX_REQUEST_BYTES = SPECTRAL_MAX_BYTES + MULTIPART_OVERHEAD;

const TOO_BIG = "Fichier trop volumineux (2 Mo maximum).";
const ARCHIVED = "Étude archivée : lecture seule.";
const UNEXPECTED = "Une erreur inattendue est survenue.";
const ROLE_REFUSALS = new Set([
  "Action réservée aux chercheurs du laboratoire.",
  "Laboratoire suspendu.",
]);

const fail = (error: string, status: number) => Response.json({ error }, { status });

function digestOf(e: unknown): string {
  if (typeof e === "object" && e !== null && "digest" in e) {
    return String((e as { digest: unknown }).digest);
  }
  return "";
}

/** Statut HTTP d'un refus métier (le message, en français, est renvoyé tel quel). */
function statusOf(message: string): number {
  if (message === ARCHIVED) return 409;
  if (message === "Étude introuvable.") return 404;
  if (message === SPECTRAL_MODEL_UNAVAILABLE) return 503;
  if (ROLE_REFUSALS.has(message)) return 403;
  return 422;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ labSlug: string; studyId: string }> },
): Promise<Response> {
  try {
    const { labSlug, studyId } = await params;

    let ctx;
    try {
      ctx = await requireLab(labSlug, "researcher");
    } catch (e) {
      const digest = digestOf(e);
      if (digest.startsWith("NEXT_REDIRECT")) return fail("Authentification requise.", 401);
      if (digest.includes("404")) return fail("Introuvable.", 404);
      throw e;
    }

    const study = await prisma.study.findFirst({
      where: { id: studyId, laboratoryId: ctx.laboratoryId },
      select: { id: true, archivedAt: true },
    });
    if (!study) return fail("Introuvable.", 404);
    assertWritable(study);

    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return fail(TOO_BIG, 413);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return fail("Requête invalide.", 400);
    }
    const parsed = await parseMultipart(request, contentType, {
      maxFileBytes: SPECTRAL_MAX_BYTES,
      maxRequestBytes: MAX_REQUEST_BYTES,
      fieldNames: ["technique", "x_unit", "y_unit", "laser_nm"],
    });
    if (parsed.kind === "too_big") return fail(TOO_BIG, 413);
    if (parsed.kind === "invalid" || parsed.bytes.length === 0) {
      return fail("Aucun fichier reçu.", 400);
    }
    const bytes = new Uint8Array(
      parsed.bytes.buffer,
      parsed.bytes.byteOffset,
      parsed.bytes.length,
    ) as Uint8Array<ArrayBuffer>;
    const { fields } = parsed;
    const result = await analyzeSpectrum(ctx, studyId, {
      fileName: parsed.name,
      mimeType: parsed.type,
      bytes,
      technique: fields.technique ?? "",
      xUnit: fields.x_unit ?? "",
      yUnit: fields.y_unit ?? "",
      laserNm: fields.laser_nm?.trim() ? fields.laser_nm : null,
    });
    return Response.json({ id: result.id });
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message, statusOf(e.message));
    if (e instanceof EngineUnavailableError) {
      return fail("Le moteur d'analyse est indisponible.", 503);
    }
    // Journal sans contenu : ni message (qui peut citer le fichier), ni nom de fichier, ni valeur.
    console.error(
      "[spectres/analyser] erreur inattendue :",
      e instanceof Error ? e.name : typeof e,
    );
    return fail(UNEXPECTED, 500);
  }
}
