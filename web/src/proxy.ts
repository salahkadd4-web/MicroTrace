import NextAuth from "next-auth";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
