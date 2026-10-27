import type { ImportResult } from "@/server/engine/client";

export type Issue = ImportResult["issues"][number];

export function issue(over: Partial<Issue> & Pick<Issue, "code" | "severity">): Issue {
  return { message: `Message ${over.code}`, row: 2, column: "Col", field: "polymer", ...over };
}

export const FIELDS = [
  { name: "sample_id", label: "Identifiant d'échantillon", description: "Identifiant." },
  { name: "polymer", label: "Polymère", description: "Polymère mesuré." },
];

export const TABLE = {
  filename: "mesures.csv",
  sha256: "abc",
  size: 2048,
  sheet: null,
  sheets: [] as string[],
  columns: ["Echantillon", "Polymere"],
  preview: [{ Echantillon: "S1", Polymere: "PE" }],
  n_rows: 1,
};

export const MAPPING = {
  mode: "long" as const,
  field_columns: { sample_id: "Echantillon", polymer: "Polymere" },
  split_aliquot_suffix: false,
};
