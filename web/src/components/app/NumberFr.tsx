/** Nombre au format français (virgule décimale). */
export function formatNumberFr(value: number, digits?: number): string {
  return new Intl.NumberFormat(
    "fr-FR",
    digits === undefined
      ? { maximumFractionDigits: 6 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits },
  ).format(value);
}

/**
 * Nombre affiché comme dans le rapport du moteur (`fmt_fr`) : entier tel quel, sinon 6 chiffres
 * significatifs au plus, zéros inutiles retirés, arrondi à la paire, sans séparateur de milliers.
 */
export function formatEngineNumberFr(value: number): string {
  const options: Intl.NumberFormatOptions =
    Number.isInteger(value) && Math.abs(value) < 1e15
      ? { maximumFractionDigits: 0 }
      : { maximumSignificantDigits: 6 };
  return new Intl.NumberFormat("fr-FR", {
    ...options,
    useGrouping: false,
    roundingMode: "halfEven",
  }).format(value);
}

/**
 * Proportion (0 à 1) au format français, par exemple « 50 % », comme le rapport du moteur :
 * une décimale au plus, arrondi à la paire (1/16 donne « 6,2 % »).
 */
export function formatPercentFr(fraction: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    maximumFractionDigits: 1,
    roundingMode: "halfEven",
  }).format(fraction);
}

export function NumberFr({
  value,
  digits,
  engine = false,
}: {
  value: number | null | undefined;
  digits?: number;
  /** Format du rapport du moteur (écran Résultats) au lieu du format courant de l'application. */
  engine?: boolean;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span>—</span>;
  }
  const formatted = engine ? formatEngineNumberFr(value) : formatNumberFr(value, digits);
  return <span className="tabular-nums">{formatted}</span>;
}
