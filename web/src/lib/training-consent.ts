/** Textes et colonnes du consentement du laboratoire (conception C5 §10). Aucun calcul ici. */

export const TRAINING_CONSENT_VERSION = "c2";

export const TRAINING_CONSENT_LABEL =
  "Autoriser l'utilisation des données validées de ce laboratoire pour améliorer les modèles";

/** Ce qui serait utilisé, ce qui ne l'est jamais, et le calendrier : montrés avant d'activer. */
export const TRAINING_CONSENT_DETAILS: readonly string[] = [
  "Seraient utilisés : les valeurs numériques des spectres déposés et le polymère retenu des analyses acceptées ou corrigées, dans les études dont la pseudonymisation est déclarée. Jamais les fichiers eux-mêmes, les noms de fichiers, les notes, les mesures ni les études simulées.",
  "Seraient aussi utilisées : les images analysées telles que réécrites par MicroTrace (pixels seulement, sans aucune métadonnée), les contours proposés et les corrections des analyses d'images acceptées ou corrigées. Jamais le fichier d'image déposé ni son nom.",
  "Le retrait s'applique aux prochains entraînements.",
  "Pendant la phase d'essai, aucune donnée de laboratoire ne sert à entraîner un modèle. Aucun réentraînement n'aura lieu avant la validation du cadre légal (loi 18-07) et du contrat avec le laboratoire.",
];

/** Colonnes de l'export (JSON : chaque ligne porte le spectre analysé par le moteur sous `spectrum`), dans l'ordre. */
export const EXPORT_COLUMNS: readonly string[] = [
  "analysis_id",
  "decision_id",
  "study_id",
  "study_nature",
  "decided_at",
  "decision",
  "label",
  "proposed_polymer",
  "proposed_status",
  "score",
  "technique",
  "x_unit",
  "y_unit",
  "laser_nm",
  "file_sha256",
  "file_size",
  "model_name",
  "model_version",
  "model_sha256",
];

export const EXPORT_FORMAT = "microtrace.spectral-training-export";

/**
 * Colonnes de l'export d'images (JSON : en plus `display_png_base64` et `particles`), dans l'ordre.
 * `scale_um_per_px` est l'échelle de l'image exportée (celle des contours), pas du fichier déposé ;
 * `validated_count = proposed_count - particules exclues + missed_count` (particules manquées signalées).
 */
export const IMAGE_EXPORT_COLUMNS: readonly string[] = [
  "analysis_id",
  "decision_id",
  "study_id",
  "study_nature",
  "decided_at",
  "decision",
  "image_sha256",
  "analysis_width",
  "analysis_height",
  "scale_um_per_px",
  "scale_source",
  "proposed_count",
  "validated_count",
  "missed_count",
  "model_name",
  "model_version",
  "model_sha256",
];

export const IMAGE_EXPORT_FORMAT = "microtrace.image-training-export";

/** Mention de l'export : préparation seulement, aucun entraînement avant le cadre légal. */
export const EXPORT_NOTICE =
  "Données d'un seul laboratoire, exportées avec son consentement. Aucun réentraînement avant la validation du cadre légal (loi 18-07, ANPDP) et du contrat. Les études simulées et les études sans pseudonymisation déclarée ne sont jamais exportées ; seules les valeurs numériques des spectres et les images réécrites par MicroTrace (sans métadonnée) avec leurs particules sont exportées (l'échelle des images est celle de l'image exportée), jamais le fichier déposé. Les pixels de l'image sont exportés tels que déposés : recadrez la bande d'informations (texte, échelle, date) avant le dépôt, seule la bande des TIFF Hitachi étant retirée automatiquement. Les analyses d'images jugées non fiables ne sont jamais exportées.";

/** Conditions préalables à tout entraînement, rappelées dans l'en-tête de l'export. */
export const EXPORT_PREREQUISITES =
  "Préparation seulement : avant tout entraînement, l'étude concernée doit être marquée « résultats validés » et l'accord juridique (loi 18-07) doit être obtenu.";

export const CONSENT_ALREADY_GIVEN = "Le consentement est déjà donné.";
export const CONSENT_NOT_GIVEN = "Le consentement n'est pas donné.";
export const NO_CONSENT_EXPORT = "Consentement non donné : aucun export.";
export const CONSENT_RENEW =
  "Le texte du consentement a changé : retirez puis accordez de nouveau le consentement avant d'exporter.";
export const EXPORT_TOO_LARGE =
  "Export trop volumineux (50 Mo maximum) : contactez l'équipe MicroTrace.";
