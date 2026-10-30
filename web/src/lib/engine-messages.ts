/** Messages fixes (jamais le détail du moteur) communs à l'écran Résultats et aux téléchargements. */
export const ENGINE_DOWN = "Le moteur d'analyse est indisponible.";
export const ENGINE_REFUSED =
  "Le moteur d'analyse n'a pas pu calculer les résultats de cette étude.";
export const QUALITY_REFUSED =
  "Le moteur d'analyse n'a pas pu calculer les signaux de qualité de cette étude.";
export const CONTEXT_CHANGED =
  "Les paramètres de l'étude (méthodes ou limites) ont changé depuis certains imports : les statuts restent ceux calculés lors de chaque import.";
export const STUDY_TOO_LARGE =
  "Étude trop volumineuse pour le calcul : retirez un import ou scindez l'étude.";
export const NO_SAMPLE_MEASUREMENTS =
  "Aucune mesure d'échantillon dans les imports actifs : importez un fichier de mesures pour voir les résultats.";
export const NOTHING_TO_EXPORT =
  "Aucune mesure d'échantillon dans les imports actifs : rien à exporter.";

/** Erreur d'un téléchargement signalée sur la page Rapport (`?erreur=`) : texte fixe. */
export const DOWNLOAD_ERRORS: Record<string, string> = {
  moteur: ENGINE_DOWN,
  refus: "Le moteur d'analyse n'a pas pu produire le fichier.",
  volume: STUDY_TOO_LARGE,
  vide: NOTHING_TO_EXPORT,
};
