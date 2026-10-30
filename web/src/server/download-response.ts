import "server-only";
import { EngineError, EngineUnavailableError } from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { requireLab, type LabContext } from "@/server/lab-context";
import { contentDisposition } from "@/server/report-files";
import type { DownloadFile } from "@/server/report-download";

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export const ENGINE_DOWN = "Le moteur d'analyse est indisponible.";
export const REPORT_REFUSED = "Le moteur d'analyse n'a pas pu produire le rapport.";
export const NOTHING_TO_EXPORT = "Aucun import actif : rien à exporter.";

/** Réponse d'erreur courte en texte brut : jamais de détail, jamais de pièce jointe. */
export function plain(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

function digestOf(e: unknown): string {
  if (typeof e === "object" && e !== null && "digest" in e) {
    return String((e as { digest: unknown }).digest);
  }
  return "";
}

/** Authentifie la requête (hors proxy) : le contexte du laboratoire, ou la réponse à renvoyer. */
export async function authenticate(
  labSlug: string,
): Promise<{ ctx: LabContext } | { response: Response }> {
  try {
    return { ctx: await requireLab(labSlug, "viewer") };
  } catch (e) {
    const digest = digestOf(e);
    if (digest.startsWith("NEXT_REDIRECT")) {
      return { response: plain("Authentification requise.", 401) };
    }
    if (digest.includes("404")) return { response: plain("Introuvable.", 404) };
    if (e instanceof DomainError) return { response: plain("Accès refusé.", 403) };
    throw e;
  }
}

export function attachment(file: DownloadFile, html = false): Response {
  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Content-Disposition": contentDisposition(file.fileName),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
  if (html) headers["Content-Security-Policy"] = CSP;
  return new Response(file.body, { status: 200, headers });
}

/** Traduit une erreur d'un téléchargement ; journal sans contenu (ni valeur ni nom de fichier). */
export function failure(e: unknown, tag: string, refused: string): Response {
  if (e instanceof DomainError) return plain("Introuvable.", 404);
  if (e instanceof EngineUnavailableError) return plain(ENGINE_DOWN, 503);
  if (e instanceof EngineError) return plain(refused, 502);
  console.error(`[${tag}] erreur inattendue :`, e instanceof Error ? e.name : typeof e);
  return plain("Une erreur inattendue est survenue.", 500);
}
