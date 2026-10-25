import "server-only";
import { parseDecimal } from "@/lib/parse-decimal";
import type { ActionState } from "@/lib/action-state";
import { DomainError } from "@/server/errors";

/** Texte d'un champ de formulaire ("" si absent). */
export function text(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

/** Valeur d'une liste fermée ; sinon refus avec le message donné. */
export function pick<T extends string>(list: readonly T[], value: string, message: string): T {
  const found = list.find((x) => x === value);
  if (!found) throw new DomainError(message);
  return found;
}

/**
 * Champs numériques (virgule française acceptée, vide = null). Renvoie les erreurs de format
 * par champ ; aucune règle scientifique ici.
 */
export function numbers<K extends string>(
  fd: FormData,
  names: readonly K[],
): { values: Record<K, number | null>; invalid: ActionState | null } {
  const values = {} as Record<K, number | null>;
  const fieldErrors: Record<string, string> = {};
  for (const name of names) {
    const r = parseDecimal(text(fd, name));
    if (r.ok) values[name] = r.value;
    else {
      values[name] = null;
      fieldErrors[name] = "Nombre invalide.";
    }
  }
  return { values, invalid: Object.keys(fieldErrors).length ? { fieldErrors } : null };
}
