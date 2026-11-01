import NextAuth from "next-auth";
import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(() => authConfig());

// Configuration paresseuse : `auth(callback)` renvoie alors une promesse du gestionnaire.
const guarded = auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isPublic =
    pathname === "/connexion" ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    // Lien d'invitation à jeton : public, c'est le jeton qui fait foi (seul ce préfixe).
    pathname.startsWith("/invitation/");
  if (isPublic || req.auth) return NextResponse.next();
  const url = new URL("/connexion", req.nextUrl);
  url.search = "";
  if (pathname !== "/") url.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(url);
});

export async function proxy(req: NextRequest, ev: NextFetchEvent) {
  const handler = (await guarded) as unknown as (
    req: NextRequest,
    ev: NextFetchEvent,
  ) => Promise<Response>;
  return handler(req, ev);
}

// Les routes de téléchargement du rapport sont aussi exclues : elles authentifient elles-mêmes
// (requireLab, 401 texte sans session, 404 hors laboratoire) et renvoient une pièce jointe, pas
// une redirection vers la page de connexion.
// La route d'analyse spectrale (2 Mio) est exclue pour la même raison et authentifie elle-même.
// La route d'analyse d'images (25 Mio) est exclue de même et authentifie elle-même.
// La route de dépôt de fichiers (jusqu'à 50 Mo) est exclue : un corps qui traverse le proxy est
// mis en mémoire tampon et tronqué au-delà de 10 Mo par défaut. Cette route authentifie elle-même
// (requireLab, avant toute lecture du corps) et répond 401 JSON sans session.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg$|apple-icon(?:.png)?$|labo/[^/]+/etudes/[^/]+/imports/upload$|labo/[^/]+/etudes/[^/]+/spectres/analyser$|labo/[^/]+/etudes/[^/]+/images/analyser$|labo/[^/]+/etudes/[^/]+/rapport/(?:telecharger|dictionnaire)$).*)",
  ],
};
