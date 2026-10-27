import { EngineError, EngineUnavailableError, engineClient } from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { putStaging } from "@/server/file-store";
import { requireLab } from "@/server/lab-context";
import { prisma } from "@/server/db";
import { assertWritable } from "@/server/studies";

export const runtime = "nodejs";

/** Taille maximale du fichier (identique à MAX_BYTES du moteur). */
const MAX_BYTES = 50 * 1024 * 1024;
/** Marge pour l'enveloppe multipart (frontières, en-têtes, champ « sheet »). */
const MULTIPART_OVERHEAD = 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_BYTES + MULTIPART_OVERHEAD;

const TOO_BIG = "Fichier trop volumineux (50 Mo maximum).";
const ARCHIVED = "Étude archivée : lecture seule.";
const UNEXPECTED = "Une erreur inattendue est survenue.";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** Lit le corps en comptant les octets ; s'arrête dès que la limite est dépassée. */
async function readBounded(request: Request, limit: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function digestOf(e: unknown): string {
  if (typeof e === "object" && e !== null && "digest" in e) {
    return String((e as { digest: unknown }).digest);
  }
  return "";
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
    const body = await readBounded(request, MAX_REQUEST_BYTES);
    if (!body) return fail(TOO_BIG, 413);

    let form: FormData;
    try {
      form = await new Response(new Uint8Array(body), {
        headers: { "content-type": contentType },
      }).formData();
    } catch {
      return fail("Requête invalide.", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Aucun fichier reçu.", 400);
    if (file.size > MAX_BYTES) return fail(TOO_BIG, 413);
    const sheetField = form.get("sheet");
    const sheet = typeof sheetField === "string" && sheetField.trim() ? sheetField : null;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const table = await engineClient.readTable({ data: bytes, filename: file.name }, sheet);
    const { token } = await putStaging(
      { userId: ctx.userId, laboratoryId: ctx.laboratoryId, studyId },
      { name: file.name, type: file.type, bytes },
    );
    return Response.json({ token, table });
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message, e.message === ARCHIVED ? 409 : 403);
    if (e instanceof EngineUnavailableError) {
      return fail("Le moteur d'analyse est indisponible.", 503);
    }
    if (e instanceof EngineError && (e.status === 422 || e.status === 413)) {
      return fail(e.detail, e.status);
    }
    // Journal sans contenu : ni message (qui peut citer le fichier), ni nom de fichier, ni jeton.
    console.error("[import/upload] erreur inattendue :", e instanceof Error ? e.name : typeof e);
    return fail(UNEXPECTED, 500);
  }
}
