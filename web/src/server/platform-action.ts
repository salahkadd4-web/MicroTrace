import "server-only";
import { notFound } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { actionError } from "@/server/action-error";
import { isPlatformAdmin } from "@/server/labs";
import { requireUser } from "@/server/session";
import type { SessionUser } from "@/server/users";

/** Console de la plateforme : 404 pour tout autre que l'équipe (relue en base). */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await isPlatformAdmin(user.id))) notFound();
  return user;
}

/** Action de la console : l'équipe est revérifiée côté serveur, toute erreur passe par `actionError`. */
export async function runPlatformAction(
  fn: (admin: SessionUser) => Promise<ActionState | void>,
): Promise<ActionState> {
  try {
    return (await fn(await requirePlatformAdmin())) ?? { ok: true };
  } catch (e) {
    return actionError(e);
  }
}
