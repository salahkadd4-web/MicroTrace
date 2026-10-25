import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { EngineUnavailableError } from "@/server/engine/client";
import { DomainError } from "@/server/errors";

const UNEXPECTED = "Une erreur inattendue est survenue.";

/**
 * Traduit une erreur d'action en état de formulaire. Les erreurs de contrôle de Next.js
 * (redirection, introuvable) sont relancées ; seuls les refus métier et l'indisponibilité du
 * moteur exposent leur message, toute autre erreur est journalisée côté serveur.
 */
export function actionError(e: unknown): ActionState {
  unstable_rethrow(e);
  if (e instanceof DomainError || e instanceof EngineUnavailableError) {
    return { error: e.message };
  }
  console.error(e);
  return { error: UNEXPECTED };
}
