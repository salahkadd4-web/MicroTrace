"use server";

import { AuthError } from "next-auth";
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
    if (e instanceof AuthError) return { error: "Identifiants invalides." };
    throw e; // redirection Next.js en cas de succès
  }
  return {};
}
