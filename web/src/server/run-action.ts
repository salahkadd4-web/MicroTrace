import "server-only";
import type { ActionState } from "@/lib/action-state";
import { actionError } from "@/server/action-error";
import { requireUser } from "@/server/session";
import type { SessionUser } from "@/server/users";

/** Exécute une action authentifiée ; toute erreur passe par `actionError`. */
export async function runAction(
  fn: (user: SessionUser) => Promise<ActionState | void>,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    return (await fn(user)) ?? { ok: true };
  } catch (e) {
    return actionError(e);
  }
}
