import "server-only";
import { ENGINE_DOWN, NOTHING_TO_EXPORT, STUDY_TOO_LARGE } from "@/lib/engine-messages";
import { EngineError, EngineUnavailableError } from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { requireLab, type LabContext } from "@/server/lab-context";
import { contentDisposition } from "@/server/report-files";
import type { DownloadFile } from "@/server/report-download";

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export { ENGINE_DOWN, NOTHING_TO_EXPORT };
export const REPORT_REFUSED = "Le moteur d'analyse n'a pas pu produire le rapport.";
export const FILE_REFUSED = "Le moteur d'analyse n'a pas pu produire le fichier.";
export const DICTIONARY_REFUSED =
  "Le moteur d'analyse n'a pas pu produire le dictionnaire de données.";
export const METHOD_NOT_ALLOWED = "Méthode non autorisée.";

/** HEAD ne doit ni appeler le moteur ni écrire d'audit : seul GET télécharge. */
export function headNotAllowed(): Response {
  const res = plain(METHOD_NOT_ALLOWED, 405);
  res.headers.set("Allow", "GET");
  return res;
}

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

/**
 * Navigation du navigateur (clic sur un lien) vers un téléchargement : une erreur y ramène sur la
 * page Rapport au lieu de remplacer l'application par une page de texte brut.
 */
export type Navigation = { request: Request; labSlug: string; studyId: string };

const isNavigation = (request: Request) => request.headers.get("sec-fetch-mode") === "navigate";
const reportPath = (n: Navigation) => `/labo/${n.labSlug}/etudes/${n.studyId}/rapport`;

/** Redirection 303 (adresse relative : indépendante du nom d'hôte vu par le serveur). */
function see(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

/** Authentifie la requête (hors proxy) : le contexte du laboratoire, ou la réponse à renvoyer. */
export async function authenticate(
  labSlug: string,
  nav?: Navigation,
): Promise<{ ctx: LabContext } | { response: Response }> {
  try {
    return { ctx: await requireLab(labSlug, "viewer") };
  } catch (e) {
    const digest = digestOf(e);
    if (digest.startsWith("NEXT_REDIRECT")) {
      if (nav && isNavigation(nav.request)) {
        // Même adresse de connexion et même paramètre que le proxy (src/proxy.ts).
        return {
          response: see(`/connexion?callbackUrl=${encodeURIComponent(reportPath(nav))}`),
        };
      }
      return { response: plain("Authentification requise.", 401) };
    }
    if (digest.includes("404")) return { response: plain("Introuvable.", 404) };
    if (e instanceof DomainError) return { response: plain("Accès refusé.", 403) };
    throw e;
  }
}

/** Aucune mesure à exporter : 409 texte, ou retour sur la page Rapport pour une navigation. */
export function nothingToExport(nav?: Navigation): Response {
  if (nav && isNavigation(nav.request)) return see(`${reportPath(nav)}?erreur=vide`);
  return plain(NOTHING_TO_EXPORT, 409);
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

/**
 * Traduit une erreur d'un téléchargement ; journal sans contenu (ni valeur ni nom de fichier).
 * Une étude d'un autre laboratoire reste un 404 (jamais de redirection qui révèle son existence).
 */
export function failure(e: unknown, tag: string, refused: string, nav?: Navigation): Response {
  const back = (code: string) =>
    nav && isNavigation(nav.request) ? see(`${reportPath(nav)}?erreur=${code}`) : null;
  if (e instanceof DomainError) return plain("Introuvable.", 404);
  if (e instanceof EngineUnavailableError) return back("moteur") ?? plain(ENGINE_DOWN, 503);
  if (e instanceof EngineError) {
    if (e.status === 413) return back("volume") ?? plain(STUDY_TOO_LARGE, 502);
    return back("refus") ?? plain(refused, 502);
  }
  console.error(`[${tag}] erreur inattendue :`, e instanceof Error ? e.name : typeof e);
  return plain("Une erreur inattendue est survenue.", 500);
}
