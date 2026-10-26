import "server-only";
import type { LabRole } from "@/generated/prisma/enums";
import type { ActionState } from "@/lib/action-state";
import { actionError } from "@/server/action-error";
import { requireLab, type LabContext } from "@/server/lab-context";

/**
 * Exécute une action authentifiée dans le laboratoire `labSlug` (revérifié côté serveur) ; toute
 * erreur passe par `actionError`. Les actions du prototype sont des écritures : rôle minimum
 * « chercheur ». Un non-membre reçoit le `notFound` de Next, relancé tel quel.
 */
export async function runAction(
  labSlug: string,
  fn: (ctx: LabContext) => Promise<ActionState | void>,
  minRole: LabRole = "researcher",
): Promise<ActionState> {
  try {
    const ctx = await requireLab(labSlug, minRole);
    return (await fn(ctx)) ?? { ok: true };
  } catch (e) {
    return actionError(e);
  }
}
