/** Nombre au format français (virgule décimale). */
export function formatNumberFr(value: number, digits?: number): string {
  return new Intl.NumberFormat(
    "fr-FR",
    digits === undefined
      ? { maximumFractionDigits: 6 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits },
  ).format(value);
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
