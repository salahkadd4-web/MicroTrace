export type ImageDecision = "accepted" | "corrected" | "rejected";
type Badge = "positive" | "warning" | "neutral";

/** Décisions humaines sur une analyse d'image ; le statut enregistré est le code de la décision. */
export const IMAGE_DECISIONS: readonly {
  code: ImageDecision;
  label: string;
  badge: Badge;
  noteRequired: boolean;
}[] = [
  { code: "accepted", label: "Acceptée", badge: "positive", noteRequired: false },
  { code: "corrected", label: "Corrigée", badge: "warning", noteRequired: false },
  { code: "rejected", label: "Rejetée", badge: "neutral", noteRequired: true },
];

export const IMAGE_STATUS_BADGES: Record<"proposal" | "unreliable", "positive" | "neutral"> = {
  proposal: "positive",
  unreliable: "neutral",
};

/** Choix par particule dans le formulaire de correction (aucune édition de contour). */
export const CORRECTION_OPTIONS: readonly {
  code: "proposed" | "fibre" | "fragment" | "bille" | "film" | "excluded";
  label: string;
}[] = [
  { code: "proposed", label: "Proposée" },
  { code: "fibre", label: "Fibre" },
  { code: "fragment", label: "Fragment" },
  { code: "bille", label: "Bille" },
  { code: "film", label: "Film" },
  { code: "excluded", label: "Pas une particule" },
];

export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.tif,.tiff";
/** Particules manquées (sans contour) déclarables sur une image. */
export const MAX_MISSED = 10_000;

/** Libellé et badge d'un statut de prédiction d'image lu en base (`null` : aucune décision). */
export function imageDecisionBadge(status: string | null): {
  label: string;
  badge: Badge | "outline";
} {
  const found = IMAGE_DECISIONS.find((d) => d.code === status);
  return found
    ? { label: found.label, badge: found.badge }
    : { label: "Non examinée", badge: "outline" };
}

/** Accord français : « 0 » et « 1 » prennent le singulier. */
export function particuleCandidates(n: number): string {
  return n < 2 ? "particule candidate" : "particules candidates";
}

export function particules(n: number): string {
  return n < 2 ? "particule" : "particules";
}

/** Conseil avant dépôt : seule la bande des TIFF Hitachi est retirée automatiquement. */
export const IMAGE_BAR_ADVICE =
  "Recadrez la bande d'informations (texte, échelle, date) avant le dépôt : seule la bande des TIFF Hitachi est retirée automatiquement. Elle pourrait être comptée comme particule et son texte resterait dans l'image exportée.";
