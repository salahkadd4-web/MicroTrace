/** Champ du dictionnaire de données du moteur, proposé dans le formulaire de correspondance. */
export type MappingField = { name: string; label: string; description: string };

/** Lit un CSV (guillemets doublés, virgules et sauts de ligne dans les champs entre guillemets). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  row.push(cell);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}

/**
 * Champs mappables, lus dans le CSV du dictionnaire servi par le moteur (`GET /dictionary`) :
 * colonnes `name`, `label_fr`, `description_fr`. Aucune liste recopiée côté web.
 */
export function parseDictionaryFields(csv: string): MappingField[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return [];
  const name = header.indexOf("name");
  const label = header.indexOf("label_fr");
  const description = header.indexOf("description_fr");
  if (name < 0) return [];
  return rows
    .filter((r) => r[name])
    .map((r) => ({
      name: r[name],
      label: (label >= 0 ? r[label] : "") || r[name],
      description: description >= 0 ? (r[description] ?? "") : "",
    }));
}
