import type { NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";

export const SESSION_MAX_AGE_MS = 8 * 3600 * 1000;

/** Durée de session absolue : `loginAt` est posé à la connexion, jamais renouvelé. */
export function jwtCallback(
  { token, user, trigger }: { token: JWT; user?: { id?: string }; trigger?: string },
  now: number = Date.now(),
): JWT | null {
  if (trigger === "signIn") {
    if (user?.id) token.sub = user.id;
    token.loginAt = now;
    return token;
  }
  const loginAt = token.loginAt;
  if (typeof loginAt !== "number" || now - loginAt > SESSION_MAX_AGE_MS) return null;
  return token;
}

/** Configuration sans accès base de données (partagée avec proxy.ts). */
export function authConfig(): NextAuthConfig {
  const secret = process.env.AUTH_SECRET;
  if (!secret)
    throw new Error(
      "La variable d'environnement AUTH_SECRET est absente : renseignez-la dans web/.env.local.",
    );
  return {
    secret,
    trustHost: true,
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_MS / 1000 },
    pages: { signIn: "/connexion" },
    providers: [],
    callbacks: {
      jwt: ({ token, user, trigger }) => jwtCallback({ token, user, trigger }),
      session({ session, token }) {
        if (typeof token.sub === "string") session.user.id = token.sub;
        return session;
      },
    },
  };
}
