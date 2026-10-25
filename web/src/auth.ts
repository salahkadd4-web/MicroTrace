import "server-only";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { authorize } from "@/server/users";

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  ...authConfig(),
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        return authorize(email, password);
      },
    }),
  ],
}));
