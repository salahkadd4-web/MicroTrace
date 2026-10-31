export type BadgeVariant = "positive" | "warning" | "destructive" | "neutral";

export type QualityDecision = "justified" | "to_check" | "entry_error";

/**
 * Décisions humaines sur un signal de qualité et leur correspondance avec `PredictionStatus`.
 * `corrected` n'est jamais écrit : la correction passe par le retrait et le réimport.
 */
export const QUALITY_DECISIONS: readonly {
  code: QualityDecision;
  label: string;
  status: "rejected" | "proposed" | "accepted";
  badge: "positive" | "warning" | "destructive";
  noteRequired: boolean;
}[] = [
  { code: "justified", label: "Examiné — justifié", status: "rejected", badge: "positive", noteRequired: true },
  { code: "to_check", label: "À vérifier", status: "proposed", badge: "warning", noteRequired: false },
  {
    code: "entry_error",
    label: "Erreur de saisie confirmée",
    status: "accepted",
    badge: "destructive",
    noteRequired: true,
  },
];

/** Phrase fixe (R-C7-4) : la décision « erreur de saisie » ne modifie aucun résultat. */
export const ENTRY_ERROR_NOTICE =
  "Cette décision ne modifie pas les résultats : la valeur reste dans Résultats et dans le rapport. Pour la corriger, retirez l'import puis importez le fichier corrigé.";

export const NOTE_MAX_LENGTH = 1000;

/** Libellé et badge d'un statut de prédiction lu en base. */
export function decisionOfStatus(status: string): { label: string; badge: BadgeVariant } {
  const found = QUALITY_DECISIONS.find((d) => d.status === status);
  if (found) return { label: found.label, badge: found.badge };
  if (status === "corrected") return { label: "Corrigé", badge: "neutral" };
  return { label: status, badge: "neutral" };
}
