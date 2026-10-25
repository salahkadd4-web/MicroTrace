import { unitLabel } from "@/lib/units";

const ACTION_LABELS: Record<string, string> = {
  "user.login": "Connexion",
  "user.create": "Compte créé",
  "project.create": "Projet créé",
  "study.create": "Étude créée",
  "study.update": "Étude modifiée",
  "study.pseudonymisation.declare": "Pseudonymisation déclarée",
  "study.archive": "Étude archivée",
  "study.method.add": "Méthode ajoutée",
  "study.limit.upsert": "Limite enregistrée",
  "study.limit.remove": "Limite supprimée",
  "study.qc.add": "Contrôle qualité ajouté",
  "study.prefill.leslie3": "Préremplissage Leslie 2022 (Tableau 3)",
};

const ENTITY_LABELS: Record<string, string> = {
  User: "Compte",
  Project: "Projet",
  Study: "Étude",
  Method: "Méthode",
  DetectionLimit: "Limite de détection",
  QualityControlSummary: "Contrôle qualité",
};

const FIELD_LABELS: Record<string, string> = {
  title: "Titre",
  description: "Description",
  projectId: "Projet",
  studyId: "Étude",
  nature: "Nature des données",
  referenceDoi: "DOI de référence",
  referenceLicense: "Licence de référence",
  blankCorrected: "Correction du blanc",
  pseudonymDeclaredAt: "Pseudonymisation déclarée le",
  archivedAt: "Archivée le",
  reason: "Motif",
  name: "Nom",
  nameKey: "Clé du nom",
  technique: "Technique",
  methodId: "Méthode",
  polymer: "Polymère",
  lod: "LOD",
  loq: "LOQ",
  unitCode: "Unité",
  source: "Source",
  kind: "Type",
  n: "Effectif",
  mean: "Moyenne",
  sd: "Écart type",
  methodsCreated: "Méthodes créées",
  limitsCreated: "Limites créées",
  ids: "Identifiants",
  id: "Identifiant",
};

/** Libellé français d'un code d'action ; un code inconnu est montré tel quel. */
export function auditActionLabel(code: string): string {
  return ACTION_LABELS[code] ?? code;
}

export function entityTypeLabel(type: string): string {
  return ENTITY_LABELS[type] ?? type;
}

export type AuditChange = { field: string; before: string; after: string };

function format(field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return field === "unitCode" ? unitLabel(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Changements champ par champ, en texte brut (jamais du JSON brut ni du HTML). */
export function diffChanges(before: unknown, after: unknown): AuditChange[] {
  const b = asRecord(before);
  const a = asRecord(after);
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return fields
    .map((f) => ({ field: f, before: format(f, b[f]), after: format(f, a[f]) }))
    .filter((c) => c.before !== c.after)
    .map((c) => ({ ...c, field: FIELD_LABELS[c.field] ?? c.field }));
}
