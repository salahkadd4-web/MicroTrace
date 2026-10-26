import "server-only";
import type { LabRole } from "@/generated/prisma/enums";
import type { ActionState } from "@/lib/action-state";
import { actionError } from "@/server/action-error";
import { requireDefaultLab, type LabContext } from "@/server/lab-context";

/**
 * Exécute une action authentifiée dans le laboratoire de l'utilisateur ; toute erreur passe par
 * `actionError`. Les actions du prototype sont des écritures : rôle minimum « chercheur ».
 * TODO(Tâche 11) : le laboratoire viendra de l'adresse /labo/[labSlug] (requireLab).
 */
export async function runAction(
  fn: (ctx: LabContext) => Promise<ActionState | void>,
  minRole: LabRole = "researcher",
): Promise<ActionState> {
  try {
    const ctx = await requireDefaultLab(minRole);
    return (await fn(ctx)) ?? { ok: true };
  } catch (e) {
    return actionError(e);
  }
}
