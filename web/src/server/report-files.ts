/** Noms de fichiers, en-têtes et CSV des téléchargements : fonctions pures, sans HTML ni calcul. */

export type DownloadFormat = "html" | "md" | "csv";

/** Titre en ASCII minuscule [a-z0-9-], sans accents, tirets réduits, 60 caractères au plus. */
export function slugTitle(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "etude";
}

// Même fuseau que l'affichage des dates (DateTimeFr) : AAAA-MM-JJ en heure de Paris.
const DAY = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Date AAAA-MM-JJ en heure de Paris (noms de fichiers). */
export function parisDay(at: Date): string {
  return DAY.format(at);
}

/** Un fichier d'étude simulée porte « SIMULE- » en tête de nom : jamais pris pour des données réelles. */
export function reportFileName(
  format: DownloadFormat,
  title: string,
  at: Date,
  simulated = false,
): string {
  const day = DAY.format(at);
  const slug = slugTitle(title);
  const prefix = simulated ? "SIMULE-" : "";
  return format === "csv"
    ? `${prefix}mesures-${slug}-${day}.csv`
    : `${prefix}rapport-${slug}-${day}.${format}`;
}

/** Pièce jointe : nom ASCII (`filename`) et sa forme étendue (`filename*`). */
export function contentDisposition(name: string): string {
  return `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Cellule CSV (RFC 4180, séparateur « ; »). Une cellule qui commence par = + - @ TAB ou CR et qui
 * n'est pas un nombre reçoit une apostrophe en tête (injection de formule des tableurs). Les valeurs
 * ne sont pas modifiées autrement ; null donne une cellule vide.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text) && !NUMBER.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export type CsvValue = string | number | boolean | null | undefined;

/** CSV Excel : BOM UTF-8, « ; », fins de ligne CRLF. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Lecteur CSV RFC 4180 (séparateur « , »), pour le dictionnaire renvoyé par le moteur. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Noms de champs du dictionnaire du moteur (colonne `name`), dans l'ordre du dictionnaire. */
export function parseDictionaryNames(csv: string): string[] {
  const [head, ...body] = parseCsv(csv);
  const col = head?.indexOf("name") ?? -1;
  if (col < 0) throw new Error("dictionnaire illisible");
  return body.map((r) => r[col]).filter((n): n is string => !!n);
}
