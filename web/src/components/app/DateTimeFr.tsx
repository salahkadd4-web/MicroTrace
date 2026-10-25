// Fuseau fixe : le rendu serveur et le rendu client donnent le même texte
// (pas d'écart d'hydratation).
const FORMAT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function DateTimeFr({ value }: { value: string | Date | null | undefined }) {
  const date = value === null || value === undefined ? null : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return <span>—</span>;
  const parts = Object.fromEntries(
    FORMAT.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const text = `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
  return <time dateTime={date.toISOString()}>{text}</time>;
}
