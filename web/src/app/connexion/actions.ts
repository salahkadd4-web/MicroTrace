"use server";

import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/callback-url";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeCallbackUrl(String(formData.get("callbackUrl") ?? ""));
  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (e) {
    // Auth.js expose `type` sur ses erreurs ; les redirections Next.js n'en ont pas.
    const type = e instanceof Error ? (e as { type?: unknown }).type : undefined;
    if (type === "CredentialsSignin") return { error: "Identifiants invalides." };
    if (typeof type === "string")
      return { error: "Connexion impossible pour le moment. Réessayez plus tard." };
    throw e; // redirection Next.js en cas de succès
  }
  return {};
}
