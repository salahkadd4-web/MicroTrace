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

/** `JJ/MM/AAAA HH:MM` (Europe/Paris), ou null si la date est absente ou invalide. */
export function formatDateTimeFr(value: string | Date | null | undefined): string | null {
  const date = value === null || value === undefined ? null : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(FORMAT.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function DateTimeFr({ value }: { value: string | Date | null | undefined }) {
  const text = formatDateTimeFr(value);
  if (text === null) return <span>—</span>;
  return <time dateTime={new Date(value as string | Date).toISOString()}>{text}</time>;
}
