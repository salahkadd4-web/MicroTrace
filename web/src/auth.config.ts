import type { NextAuthConfig } from "next-auth";

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
    session: { strategy: "jwt", maxAge: 8 * 3600 },
    pages: { signIn: "/connexion" },
    providers: [],
    callbacks: {
      jwt({ token, user }) {
        if (user?.id) token.uid = user.id;
        return token;
      },
      session({ session, token }) {
        if (typeof token.uid === "string") session.user.id = token.uid;
        return session;
      },
    },
  };
}
