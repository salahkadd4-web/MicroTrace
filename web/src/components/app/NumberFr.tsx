/** Nombre au format français (virgule décimale). */
export function formatNumberFr(value: number, digits?: number): string {
  return new Intl.NumberFormat(
    "fr-FR",
    digits === undefined
      ? { maximumFractionDigits: 6 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits },
  ).format(value);
}

/** Proportion (0 à 1) au format français, par exemple « 50 % ». */
export function formatPercentFr(fraction: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 }).format(
    fraction,
  );
}

export function NumberFr({
  value,
  digits,
}: {
  value: number | null | undefined;
  digits?: number;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span>—</span>;
  }
  const formatted = formatNumberFr(value, digits);
  return <span className="tabular-nums">{formatted}</span>;
}
