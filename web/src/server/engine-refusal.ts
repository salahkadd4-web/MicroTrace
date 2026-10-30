import "server-only";
import { EngineError } from "@/server/engine/client";
import { DomainError } from "@/server/errors";

/**
 * Un refus du moteur sur le contenu du fichier (422) ou sa taille (413) devient un refus métier
 * portant le texte français du moteur ; toute autre erreur est renvoyée telle quelle.
 */
export function engineRefusal(e: unknown): unknown {
  if (e instanceof EngineError && (e.status === 422 || e.status === 413)) {
    return new DomainError(e.detail);
  }
  return e;
}

/** Exécute un appel au moteur en traduisant ses refus 422 / 413. */
export async function refusingEngine<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    throw engineRefusal(e);
  }
}
