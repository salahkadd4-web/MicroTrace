import { createHash } from "node:crypto";
import type {
  ImageAnalyzeResponse,
  ImageModelInfo,
  ImageValidatedSummary,
} from "@/server/engine/client";

/** Deux PNG de 1 × 1 différents : l'image d'analyse et l'image annotée du simulacre du moteur. */
export const DISPLAY_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const ANNOTATED_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
export const MODEL_SHA = "ef".repeat(32);

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export const DISPLAY_SHA = sha(Buffer.from(DISPLAY_B64, "base64"));
export const ANNOTATED_SHA = sha(Buffer.from(ANNOTATED_B64, "base64"));

const SHAPES = ["fibre", "fragment", "fragment", "bille", "uncertain"] as const;
const LABELS = { fibre: "Fibre", fragment: "Fragment", bille: "Bille", uncertain: "Forme incertaine" };

function particle(i: number) {
  const shape = SHAPES[i];
  return {
    id: i + 1,
    contour: [
      [1, 1],
      [10, 1],
      [10, 10],
    ],
    bbox: [1, 1, 10, 10],
    area_px: 100 + i,
    feret_max_px: 20 + i,
    feret_min_px: 5,
    area_um2: 25 + i,
    feret_max_um: 10 + i,
    feret_min_um: 2.5,
    eq_diameter_um: 5.6,
    circularity: 0.5,
    solidity: 0.9,
    elongation: 3,
    touches_border: false,
    shape,
    shape_label: LABELS[shape],
    shape_score: 0.8 - i * 0.1,
    shape_score_text: "0,80",
    shape_status: shape === "uncertain" ? "uncertain" : "proposed",
  };
}

const SCALE = {
  um_per_px_input: 0.5,
  um_per_px_analysis: 0.5,
  source: "entered",
  source_label: "saisie",
  min_detectable_um: 14,
};

/** Proposition de 5 particules, échelle saisie (0,5 µm/px). */
export function proposalFor(bytes: Uint8Array): ImageAnalyzeResponse {
  return {
    model: { name: "c6-microscopie", version: "i1", sha256: MODEL_SHA },
    trial_label: "Modèle d'essai",
    trial_sentence: "Modèle d'essai : entraîné sur des images publiques.",
    input: {
      sha256: sha(bytes),
      size: bytes.length,
      format: "PNG",
      width: 256,
      height: 192,
      bit_depth: 8,
      color: "gray",
      orientation_applied: false,
      alpha_ignored: false,
      cropped_bottom_px: 0,
      analysis_width: 256,
      analysis_height: 192,
      downscale: 1,
    },
    scale: SCALE,
    status: "proposal",
    status_label: "Proposition",
    reasons: [],
    explanation: "5 particules candidates.",
    count: 5,
    count_by_shape: [
      { shape: "fibre", label: "Fibre", count: 1 },
      { shape: "fragment", label: "Fragment", count: 2 },
      { shape: "bille", label: "Bille", count: 1 },
      { shape: "film", label: "Film", count: 0 },
      { shape: "uncertain", label: "Forme incertaine", count: 1 },
    ],
    particles: [0, 1, 2, 3, 4].map(particle),
    size_distribution: null,
    images: { display_png_base64: DISPLAY_B64, annotated_png_base64: ANNOTATED_B64 },
    thresholds: { pixel: 0.5, min_area_frac: 0.01, shape_min_score: 0.5, max_foreground: 0.4, min_contrast: 0.1 },
    limits: ["l1"],
    shape_vocabulary: [
      { code: "fibre", label: "Fibre", evaluated: true },
      { code: "film", label: "Film", evaluated: false },
    ],
  } as unknown as ImageAnalyzeResponse;
}

/** Abstention : aucune particule candidate. */
export function unreliableFor(bytes: Uint8Array): ImageAnalyzeResponse {
  return {
    ...proposalFor(bytes),
    scale: null,
    status: "unreliable",
    status_label: "Non fiable (abstention)",
    reasons: [{ code: "no_particle", label: "aucune particule candidate détectée" }],
    explanation: "Aucune proposition fiable.",
    count: 0,
    count_by_shape: [],
    particles: [],
  } as unknown as ImageAnalyzeResponse;
}

/** Réponse de `/ai/image/validate` du simulacre. */
export const VALIDATED: ImageValidatedSummary = {
  count: 5,
  kept: 4,
  excluded: 1,
  missed: 1,
  count_by_shape: [
    { shape: "fibre", label: "Fibre", count: 1 },
    { shape: "fragment", label: "Fragment", count: 1 },
    { shape: "bille", label: "Bille", count: 1 },
    { shape: "film", label: "Film", count: 0 },
    { shape: "uncertain", label: "Forme incertaine", count: 1 },
    { shape: "unspecified", label: "Forme non renseignée", count: 1 },
  ],
  size_distribution: { basis: "feret_max_um", bins: [], median_um: 11.5, p10_um: 10, p90_um: 13 },
  changes: 0,
  sentence: "4 particules candidates validées.",
} as unknown as ImageValidatedSummary;

export const MODEL_INFO = { available: true, name: "c6-microscopie", version: "i1" } as unknown as ImageModelInfo;
