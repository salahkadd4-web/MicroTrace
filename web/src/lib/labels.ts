import type { DataNature } from "@/components/app/DataNatureBanner";
import type { QC_KINDS, TECHNIQUES } from "@/server/engine/enums";

export const NATURE_LABELS: Record<DataNature, string> = {
  published: "Publiée",
  laboratory: "Laboratoire",
  simulated: "Simulée",
};

export const BLANK_CORRECTED_LABELS = {
  yes: "Oui",
  no: "Non",
  unknown: "Inconnu",
} as const;

export const TECHNIQUE_LABELS: Record<(typeof TECHNIQUES)[number], string> = {
  py_gc_ms: "Py-GC/MS",
  ted_gc_ms: "TED-GC/MS",
  micro_ftir: "Micro-FTIR",
  micro_raman: "Micro-Raman",
  other: "Autre",
};

export const QC_KIND_LABELS: Record<(typeof QC_KINDS)[number], string> = {
  procedural_blank: "Blanc procédural",
  field_blank: "Blanc de terrain",
  spiked: "Échantillon dopé",
};

export const ROLE_LABELS: Record<"lab_admin" | "researcher" | "viewer", string> = {
  lab_admin: "Responsable",
  researcher: "Chercheur",
  viewer: "Lecteur",
};

/** Libellé d'une valeur de liste ; un code inconnu est montré tel quel. */
export function labelOf(labels: Record<string, string>, code: string): string {
  return labels[code] ?? code;
}

export function toOptions(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}
