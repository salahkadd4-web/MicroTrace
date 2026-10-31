export type SpectralDecision = "accepted" | "corrected" | "rejected";
type Badge = "positive" | "warning" | "neutral";

/** Décisions humaines sur une analyse spectrale ; le statut enregistré est le code de la décision. */
export const SPECTRAL_DECISIONS: readonly {
  code: SpectralDecision;
  label: string;
  status: SpectralDecision;
  badge: Badge;
  noteRequired: boolean;
  needsPolymer: boolean;
}[] = [
  { code: "accepted", label: "Acceptée", status: "accepted", badge: "positive", noteRequired: false, needsPolymer: false },
  { code: "corrected", label: "Corrigée", status: "corrected", badge: "warning", noteRequired: false, needsPolymer: true },
  { code: "rejected", label: "Rejetée", status: "rejected", badge: "neutral", noteRequired: true, needsPolymer: false },
];

/** Corrections qui exigent une note (le polymère n'est pas dans le catalogue). */
export const NOTE_REQUIRED_POLYMERS: readonly string[] = ["OTHER", "NOT_PLASTIC"];

export const SPECTRAL_STATUS_BADGES: Record<"identified" | "uncertain" | "not_identified", Badge> = {
  identified: "positive",
  uncertain: "warning",
  not_identified: "neutral",
};

export const SPECTRAL_MAX_BYTES = 2 * 1024 * 1024;

export const TECHNIQUE_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "raman", label: "Raman" },
  { code: "ftir_atr", label: "FTIR (ATR)" },
];

export const X_UNIT_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "cm-1", label: "Nombre d'onde (cm⁻¹)" },
  { code: "nm", label: "Longueur d'onde (nm), Raman seulement" },
];

export const Y_UNIT_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "intensity", label: "Intensité (Raman)" },
  { code: "absorbance", label: "Absorbance (FTIR)" },
  { code: "transmittance_pct", label: "Transmittance en % (FTIR)" },
];

/** Libellé et badge d'un statut de prédiction spectrale lu en base (`null` : aucune décision). */
export function spectralDecisionBadge(status: string | null): {
  label: string;
  badge: Badge | "outline";
} {
  const found = SPECTRAL_DECISIONS.find((d) => d.status === status);
  return found
    ? { label: found.label, badge: found.badge }
    : { label: "Non examinée", badge: "outline" };
}

/** Les bibliothèques sans référence complète portent « À compléter » côté moteur. */
export function citationText(citation: string): string {
  return citation.trim().toLowerCase() === "à compléter" ? "Référence à compléter." : citation;
}

/** Axe horizontal tel que le chercheur l'a déclaré (jamais l'étiquette du graphique). */
export function declaredXUnitText(xUnit: string, laserNm: number | null): string {
  if (xUnit === "nm") {
    return laserNm !== null
      ? `Longueur d'onde (nm), convertie en cm⁻¹ avec le laser (${new Intl.NumberFormat("fr-FR").format(laserNm)} nm)`
      : "Longueur d'onde (nm), convertie en cm⁻¹ avec le laser";
  }
  return X_UNIT_OPTIONS.find((o) => o.code === xUnit)?.label ?? xUnit;
}

export function declaredYUnitText(yUnit: string): string {
  return Y_UNIT_OPTIONS.find((o) => o.code === yUnit)?.label ?? yUnit;
}
