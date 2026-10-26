import { formatDateTimeFr } from "@/components/app/DateTimeFr";
import { formatNumberFr } from "@/components/app/NumberFr";
import {
  BLANK_CORRECTED_LABELS,
  NATURE_LABELS,
  QC_KIND_LABELS,
  TECHNIQUE_LABELS,
  labelOf,
} from "@/lib/labels";
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

export type AuditContext = {
  /** Noms des méthodes de l'étude, par identifiant (pour afficher un nom plutôt qu'un identifiant). */
  methodNames?: ReadonlyMap<string, string>;
};

/** Champs techniques sans intérêt pour la lecture : jamais affichés. */
const HIDDEN_FIELDS = new Set(["id", "ids", "studyId", "projectId", "nameKey"]);

const VALUE_LABELS: Record<string, Record<string, string>> = {
  nature: NATURE_LABELS,
  blankCorrected: BLANK_CORRECTED_LABELS,
  technique: TECHNIQUE_LABELS,
  kind: QC_KIND_LABELS,
};

const ABSENT = "—";

/** Valeur lisible, ou null si elle ne peut pas être présentée (objet, identifiant introuvable). */
function format(field: string, value: unknown, ctx: AuditContext): string | null {
  if (value === null || value === undefined) return ABSENT;
  if (field === "methodId") {
    return typeof value === "string" ? (ctx.methodNames?.get(value) ?? null) : null;
  }
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") return formatNumberFr(value);
  if (typeof value !== "string") return null;
  if (field === "unitCode") return unitLabel(value);
  const labels = VALUE_LABELS[field];
  if (labels) return labelOf(labels, value);
  if (field.endsWith("At")) return formatDateTimeFr(value) ?? value;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Changements champ par champ, en texte lisible (jamais du JSON, des identifiants ni du HTML). */
export function diffChanges(before: unknown, after: unknown, ctx: AuditContext = {}): AuditChange[] {
  const b = asRecord(before);
  const a = asRecord(after);
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (f) => !HIDDEN_FIELDS.has(f),
  );
  const changes: AuditChange[] = [];
  for (const f of fields) {
    const from = format(f, b[f], ctx);
    const to = format(f, a[f], ctx);
    if (from === null || to === null || from === to) continue;
    changes.push({ field: FIELD_LABELS[f] ?? f, before: from, after: to });
  }
  return changes;
}

/** Nom de l'objet d'un événement (titre, nom, polymère), ou null s'il n'est pas connu. */
export function auditObjectName(
  event: { entityType: string; before: unknown; after: unknown },
  ctx: AuditContext = {},
): string | null {
  const data = { ...asRecord(event.before), ...asRecord(event.after) };
  const str = (k: string) => (typeof data[k] === "string" && data[k] ? (data[k] as string) : null);
  switch (event.entityType) {
    case "Study":
    case "Project":
      return str("title");
    case "Method":
      return str("name");
    case "DetectionLimit":
    case "QualityControlSummary": {
      const polymer = str("polymer");
      const method = typeof data.methodId === "string" ? ctx.methodNames?.get(data.methodId) : null;
      if (!polymer) return null;
      return method ? `${polymer} (${method})` : polymer;
    }
    default:
      return null;
  }
}
