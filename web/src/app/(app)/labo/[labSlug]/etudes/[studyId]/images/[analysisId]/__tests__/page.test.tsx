import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({ requireLab: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/labo/labo/etudes/s1/images/an1",
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/studies", () => ({ getStudyView: vi.fn() }));
vi.mock("@/server/images", () => ({ getImageAnalysis: vi.fn(), getImageModel: vi.fn() }));
vi.mock("../actions", () => ({ recordImageDecisionAction: vi.fn() }));
vi.mock("recharts", () => {
  const box = (name: string) => {
    const Box = ({ children }: { children?: ReactNode }) => <div data-testid={name}>{children}</div>;
    Box.displayName = name;
    return Box;
  };
  return {
    ResponsiveContainer: box("container"),
    BarChart: box("chart"),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Bar: () => null,
  };
});

import { getImageAnalysis, getImageModel } from "@/server/images";
import { requireLab } from "@/server/lab-context";
import { getStudyView } from "@/server/studies";
import StudyLayout from "../../../layout";
import ImageAnalysisPage from "../page";

const study = (archivedAt: Date | null = null) => ({
  id: "s1",
  title: "Étude Leslie",
  nature: "published" as const,
  archivedAt,
  project: { id: "p1", title: "Projet un" },
});
const asRole = (role: string) =>
  ({ userId: "u1", userName: "Alice", laboratoryId: "lab1", labSlug: "labo", labName: "Labo", role }) as never;

const sq = (o: number) => [[o, o], [o + 10, o], [o + 10, o + 10], [o, o + 10]];
const particle = (id: number, shape: string, over: object = {}) => ({
  id,
  contour: sq(id * 20),
  bbox: [0, 0, 10, 10],
  area_px: 100,
  feret_max_px: 14,
  feret_min_px: 10,
  area_um2: 25,
  feret_max_um: 7.1,
  feret_min_um: 5,
  eq_diameter_um: 5.6,
  circularity: 0.8,
  solidity: 0.9,
  elongation: 1.2,
  touches_border: id === 2,
  shape,
  shape_label: shape === "uncertain" ? "Forme incertaine" : shape === "fibre" ? "Fibre" : "Fragment",
  shape_score: 0.7,
  shape_score_text: "0,70",
  shape_status: shape === "uncertain" ? "uncertain" : "proposed",
  ...over,
});
const BINS = Array.from({ length: 9 }, (_, i) => ({ lower: i, upper: i + 1, label: `classe ${i + 1}`, count: i === 1 ? 3 : 0 }));

const output = (over: object = {}) => ({
  model: { name: "c6-microscopie", version: "i1", sha256: "a" },
  trial_label: "Modèle d'essai",
  trial_sentence: "Modèle d'essai : …",
  input: {
    sha256: "f".repeat(64), size: 1000, format: "TIFF", width: 2560, height: 1800, bit_depth: 8,
    color: "gray", orientation_applied: false, alpha_ignored: false, cropped_bottom_px: 112,
    analysis_width: 1024, analysis_height: 720, downscale: 2.5,
  },
  scale: { um_per_px_input: 0.5, um_per_px_analysis: 1.25, source: "entered", source_label: "saisie", min_detectable_um: 14 },
  status: "proposal",
  status_label: "Proposition",
  reasons: [],
  explanation: "5 particules candidates (2 fibres, 3 fragments) d'au moins 14 µm. Proposition à valider par une personne compétente.",
  count: 5,
  count_by_shape: [
    { shape: "fibre", label: "Fibre", count: 2 },
    { shape: "fragment", label: "Fragment", count: 2 },
    { shape: "uncertain", label: "Forme incertaine", count: 1 },
  ],
  particles: [
    particle(1, "fibre"), particle(2, "fragment"), particle(3, "fragment"),
    particle(4, "uncertain"), particle(5, "fibre"),
  ],
  size_distribution: { basis: "feret_max_um", bins: BINS, median_um: 8, p10_um: 6, p90_um: 20 },
  thresholds: { pixel: 0.7, min_area_frac: 0.005, shape_min_score: 0.6, max_foreground: 0.25, min_contrast: 10 },
  limits: [],
  shape_vocabulary: [],
  ...over,
});

const analysis = (over: object = {}, outOver: object = {}) => ({
  id: "an1",
  createdAt: new Date("2026-10-01T10:00:00Z"),
  fileName: "photo.tif",
  status: "proposal",
  statusLabel: "Proposition",
  count: 5,
  scaleSource: "entered",
  scaleSourceLabel: "saisie",
  modelVersion: "i1",
  decision: null,
  createdBy: "Alice",
  sizeBytes: 2048,
  inputSha256: "f".repeat(64),
  scaleEntered: "0.5",
  modelName: "c6-microscopie",
  modelSha256: "a".repeat(64),
  output: output(outOver),
  archived: false,
  ...over,
});

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1", analysisId: "an1" });
  const page = await ImageAnalysisPage({ params });
  render(await StudyLayout({ params, children: page }));
}

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue(asRole("researcher"));
  vi.mocked(getStudyView).mockResolvedValue(study() as never);
  vi.mocked(getImageAnalysis).mockResolvedValue(analysis() as never);
  vi.mocked(getImageModel).mockResolvedValue({
    kind: "ok",
    info: { version: "i1", expected_sha256: "a".repeat(64) },
  } as never);
});

describe("page d'une analyse d'image", () => {
  it("un seul h1 ; explication mot pour mot ; échelle saisie ; liens de téléchargement", async () => {
    await renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByText("5 particules candidates (2 fibres, 3 fragments) d'au moins 14 µm. Proposition à valider par une personne compétente."),
    ).toBeInTheDocument();
    expect(screen.getByText("0,5 µm/px (saisie)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Télécharger l'image annotée (PNG)" })).toHaveAttribute(
      "href", "/labo/labo/etudes/s1/images/an1/annotee",
    );
    expect(screen.getByRole("link", { name: "Télécharger les particules (CSV)" })).toHaveAttribute(
      "href", "/labo/labo/etudes/s1/images/an1/particules",
    );
  });

  it("calque : image du magasin, viewBox de l'image d'analyse, 5 contours", async () => {
    await renderPage();
    const svg = screen.getByRole("img", { name: "Image analysée : 5 particules candidates délimitées" });
    expect(svg).toHaveAttribute("viewBox", "0 0 1024 720");
    expect(svg.querySelectorAll("polygon")).toHaveLength(5);
    expect(document.querySelector("figure img")).toHaveAttribute("src", "/labo/labo/etudes/s1/images/an1/image");
  });

  it("échelle inconnue : tailles en pixels, pas de distribution", async () => {
    vi.mocked(getImageAnalysis).mockResolvedValue(
      analysis({}, { scale: null, size_distribution: null }) as never,
    );
    await renderPage();
    expect(screen.getByText("inconnue")).toBeInTheDocument();
    expect(screen.getByText("Échelle inconnue : pas de distribution en µm.")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Particules candidates (tailles en pixels)" });
    expect(within(table).getAllByRole("columnheader")[2]).toHaveTextContent("Feret max (px)");
  });

  it("non fiable : raisons en liste, « Acceptée » absent du formulaire", async () => {
    vi.mocked(getImageAnalysis).mockResolvedValue(
      analysis({}, {
        status: "unreliable",
        status_label: "Non fiable (abstention)",
        reasons: [
          { code: "large_foreground", label: "47 % de l'image est segmentée" },
          { code: "low_contrast", label: "contraste trop faible" },
        ],
        explanation: "Aucune proposition fiable : 47 % de l'image est segmentée ; contraste trop faible.",
      }) as never,
    );
    await renderPage();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain("47 % de l'image est segmentée");
    expect(items).toContain("contraste trop faible");
    expect(screen.queryByRole("radio", { name: "Acceptée" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Corrigée" })).toBeInTheDocument();
  });

  it("forme incertaine dans la table des particules", async () => {
    await renderPage();
    const table = screen.getByRole("table", { name: "Particules candidates (tailles en micromètres)" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(table).toHaveTextContent("Forme incertaine");
    expect(table).toHaveTextContent("tronquée");
  });

  it("table coupée à 300 lignes : note avec le nombre de particules non affichées", async () => {
    const many = Array.from({ length: 302 }, (_, i) => particle(i + 1, "fibre"));
    vi.mocked(getImageAnalysis).mockResolvedValue(
      analysis({}, { count: 302, particles: many }) as never,
    );
    await renderPage();
    expect(screen.getByText(/2 autres particules non affichées/)).toBeInTheDocument();
  });

  it("version du modèle différente : alerte", async () => {
    vi.mocked(getImageModel).mockResolvedValue({ kind: "ok", info: { version: "i2", expected_sha256: "b" } } as never);
    await renderPage();
    expect(screen.getByText(/Analyse faite avec la version i1 du modèle ; version actuelle : i2\./)).toBeInTheDocument();
  });

  it("viewer et étude archivée : lecture seule, pas de formulaire", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("viewer"));
    await renderPage();
    expect(screen.queryByRole("button", { name: "Enregistrer la décision" })).not.toBeInTheDocument();
    cleanup();
    vi.mocked(requireLab).mockResolvedValue(asRole("researcher"));
    vi.mocked(getImageAnalysis).mockResolvedValue(analysis({ archived: true }) as never);
    await renderPage();
    expect(screen.getByText("Étude archivée : les analyses et décisions sont en lecture seule.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer la décision" })).not.toBeInTheDocument();
  });

  it("décision enregistrée : phrase du moteur et note", async () => {
    vi.mocked(getImageAnalysis).mockResolvedValue(
      analysis({
        decision: {
          id: "d1", decision: "corrected", note: "Deux fibres croisées", decidedBy: "Alice",
          decidedAt: new Date("2026-10-02T10:00:00Z"), count: 2, excluded: [1], reshaped: [], missed: 0,
          validated: { count: 4, kept: 4, excluded: 1, missed: 0, count_by_shape: [], size_distribution: null, changes: 0, sentence: "4 particules candidates validées : 4 proposées gardées, 1 exclue." },
        },
      }) as never,
    );
    await renderPage();
    expect(screen.getByText("4 particules candidates validées : 4 proposées gardées, 1 exclue.")).toBeInTheDocument();
    expect(screen.getByText("Deux fibres croisées")).toBeInTheDocument();
    expect(screen.getByText(/2 décisions, voir le Journal/)).toBeInTheDocument();
  });

  it("analyse inconnue : 404", async () => {
    vi.mocked(getImageAnalysis).mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
