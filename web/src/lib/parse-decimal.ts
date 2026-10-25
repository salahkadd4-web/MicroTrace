export type DecimalResult = { ok: true; value: number | null } | { ok: false };

const DECIMAL = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/;

/**
 * Lecture d'un nombre saisi : virgule ou point décimal, vide devient null.
 * Contrôle de format uniquement, aucune règle scientifique.
 */
export function parseDecimal(raw: string | null | undefined): DecimalResult {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: true, value: null };
  if (!DECIMAL.test(text)) return { ok: false };
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}
