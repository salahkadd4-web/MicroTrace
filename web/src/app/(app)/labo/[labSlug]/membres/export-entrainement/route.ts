import { NO_CONSENT_EXPORT } from "@/lib/training-consent";
import {
  attachment,
  authenticate,
  failure,
  headNotAllowed,
  plain,
} from "@/server/download-response";
import { DomainError } from "@/server/errors";
import { buildTrainingExport } from "@/server/training-consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ labSlug: string }> },
): Promise<Response> {
  const { labSlug } = await params;
  const auth = await authenticate(labSlug);
  if ("response" in auth) return auth.response;
  // Réservé aux responsables : pour les autres la page n'existe pas (comme la page Membres).
  if (auth.ctx.role !== "lab_admin") return plain("Introuvable.", 404);

  const format = new URL(request.url).searchParams.get("format");
  if (format !== "json" && format !== "csv") return plain("Format d'export inconnu.", 400);
  try {
    return attachment(await buildTrainingExport(auth.ctx, format));
  } catch (e) {
    if (e instanceof DomainError && e.message === NO_CONSENT_EXPORT) {
      return plain(NO_CONSENT_EXPORT, 403);
    }
    return failure(e, "membres/export-entrainement", "Le fichier n'a pas pu être produit.");
  }
}

export const HEAD = headNotAllowed;
