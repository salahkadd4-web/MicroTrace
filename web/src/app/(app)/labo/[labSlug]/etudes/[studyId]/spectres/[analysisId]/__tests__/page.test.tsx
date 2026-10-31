import { cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({ requireLab: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/labo/labo/etudes/s1/spectres/an1",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/studies", () => ({ getStudyView: vi.fn() }));
vi.mock("@/server/spectral", () => ({
  getSpectralModel: vi.fn(),
  getSpectralAnalysis: vi.fn(),
}));
vi.mock("../actions", () => ({ recordSpectralDecisionAction: vi.fn() }));
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: () => null };
});

import { requireLab } from "@/server/lab-context";
import { getSpectralAnalysis, getSpectralModel } from "@/server/spectral";
import { getStudyView } from "@/server/studies";
import StudyLayout from "../../../layout";
import AnalysisPage from "../page";

const study = (archivedAt: Date | null = null) => ({
  id: "s1",
  title: "Étude Leslie",
  nature: "published" as const,
  archivedAt,
  project: { id: "p1", title: "Projet un" },
});
const asRole = (role: string) =>
  ({ userId: "u1", userName: "Alice", laboratoryId: "lab1", labSlug: "labo", labName: "Labo", role }) as never;

const curve = { x: [400, 500], y: [0, 1] };
const ref = (rank: number, over: object = {}) => ({
  rank,
  spectrum_id: `mpx-${rank}`,
  library: "microplastix",
  library_name: "MicroPlastiX",
  citation: "Citation MicroPlastiX.",
  licence_text: "CC BY 4.0",
  polymer: "PE",
  label: "Polyéthylène",
  score: 0.9,
  score_text: "0,900",
  curve,
  curve_note: null,
  ...over,
});

const output = (over: object = {}) => ({
  model: { name: "spectral", version: "s1", sha256: "m".repeat(64) },
  trial_label: "Modèle d'essai",
  trial_sentence: "Modèle d'essai : ...",
  input: {
    sha256: "f".repeat(64),
    size: 1000,
    n_points: 300,
    x_min: 400,
    x_max: 3000,
    technique: "raman",
    technique_label: "Raman",
    x_unit: "cm-1",
    y_unit: "intensity",
    laser_nm: 785,
    diagnostic_coverage: 0.96,
    window_min: 600,
    window_max: 1800,
  },
  status: "identified",
  status_label: "Identifié (proposition)",
  abstention: null,
  explanation: "Le spectre ressemble surtout au polyéthylène (corrélation 0,900).",
  candidates: [
    { rank: 1, polymer: "PE", label: "Polyéthylène", score: 0.9, score_text: "0,900" },
    { rank: 2, polymer: "PP", label: "Polypropylène", score: 0.7, score_text: "0,700" },
  ],
  margin: 0.2,
  classifier_polymer: "PE",
  classifier_label: "Polyéthylène",
  references: [
    ref(1),
    ref(2, { library: "other", library_name: "Autre bibliothèque", spectrum_id: "oth-1", citation: "Citation autre.", licence_text: "À confirmer", curve: null, curve_note: "Licence à confirmer : courbe non affichée." }),
  ],
  query_curve: curve,
  x_label: "Déplacement Raman (cm⁻¹)",
  y_label: "Intensité normalisée (après prétraitement)",
  thresholds: { uncertain_min_score: 0.5, identified_min_score: 0.8, identified_min_margin: 0.05, classifier_agreement_required: true },
  limits: [],
  correction_vocabulary: [
    { code: "PE", label: "Polyéthylène" },
    { code: "OTHER", label: "Autre polymère" },
  ],
  ...over,
});

const analysis = (outOver: object = {}, over: object = {}) => ({
  id: "an1",
  createdAt: new Date("2026-10-01T10:00:00Z"),
  fileName: "spectre.csv",
  techniqueLabel: "Raman",
  status: "identified",
  statusLabel: "Identifié (proposition)",
  proposedLabel: "Polyéthylène",
  modelVersion: "s1",
  decision: null,
  createdBy: "Alice",
  sizeBytes: 2048,
  inputSha256: "f".repeat(64),
  technique: "raman",
  xUnit: "cm-1",
  yUnit: "intensity",
  laserNm: 785,
  modelName: "spectral",
  modelSha256: "m".repeat(64),
  output: output(outOver),
  archived: false,
  ...over,
});

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1", analysisId: "an1" });
  const page = await AnalysisPage({ params });
  render(await StudyLayout({ params: Promise.resolve({ labSlug: "labo", studyId: "s1" }), children: page }));
}

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue(asRole("researcher"));
  vi.mocked(getStudyView).mockResolvedValue(study() as never);
  vi.mocked(getSpectralModel).mockResolvedValue({ kind: "ok", info: { version: "s1" } } as never);
  vi.mocked(getSpectralAnalysis).mockResolvedValue(analysis() as never);
});

describe("page d'une analyse", () => {
  it("explication mot pour mot, table des polymères proposés, avis du classifieur", async () => {
    await renderPage();
    expect(
      screen.getByText("Le spectre ressemble surtout au polyéthylène (corrélation 0,900)."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Polymères proposés" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Polymères proposés" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Rang",
      "Polymère",
      "Corrélation",
    ]);
    expect(within(table).getByText("0,700")).toBeInTheDocument();
    expect(screen.getByText("Avis du classifieur PCA+SVM : Polyéthylène")).toBeInTheDocument();
  });

  it("abstention : titre « à titre indicatif » et pas d'option Acceptée", async () => {
    vi.mocked(getSpectralAnalysis).mockResolvedValue(
      analysis({ status: "not_identified", status_label: "Non identifié (abstention)" }) as never,
    );
    await renderPage();
    expect(
      screen.getByRole("heading", { name: "Polymères les plus proches (à titre indicatif)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Acceptée" })).not.toBeInTheDocument();
  });

  it("une référence sans courbe affiche la note du moteur ; courbe « affichée » sinon", async () => {
    await renderPage();
    const table = screen.getByRole("table", { name: "Spectres de référence les plus proches" });
    expect(within(table).getByText("Licence à confirmer : courbe non affichée.")).toBeInTheDocument();
    expect(within(table).getByText("affichée")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Spectre déposé superposé aux spectres de référence affichables (1)",
      }),
    ).toBeInTheDocument();
  });

  it("axe et ordonnée déclarés : nm avec laser, puis transmittance", async () => {
    vi.mocked(getSpectralAnalysis).mockResolvedValue(
      analysis({}, { xUnit: "nm", laserNm: 532 }) as never,
    );
    await renderPage();
    expect(screen.getByText("Axe déclaré")).toBeInTheDocument();
    expect(
      screen.getByText("Longueur d'onde (nm), convertie en cm⁻¹ avec le laser (532 nm)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Intensité (Raman)")).toBeInTheDocument();
    cleanup();
    vi.mocked(getSpectralAnalysis).mockResolvedValue(
      analysis(
        { input: { ...output().input, technique: "ftir_atr", y_unit: "transmittance_pct", laser_nm: null } },
        { technique: "ftir_atr", yUnit: "transmittance_pct", laserNm: null },
      ) as never,
    );
    await renderPage();
    expect(screen.getByText("Nombre d'onde (cm⁻¹)")).toBeInTheDocument();
    expect(screen.getByText("Transmittance en % (FTIR)")).toBeInTheDocument();
  });

  it("tableau des références : cellules longues à la ligne ; citation à compléter ; licence CC BY-SA", async () => {
    vi.mocked(getSpectralAnalysis).mockResolvedValue(
      analysis({
        references: [
          ref(1, { licence_text: "CC BY-SA 4.0" }),
          ref(2, { library: "other", library_name: "Autre", citation: "À compléter", curve: null, curve_note: "Licence à confirmer : courbe non affichée." }),
        ],
      }) as never,
    );
    await renderPage();
    const table = screen.getByRole("table", { name: "Spectres de référence les plus proches" });
    expect(within(table).getByText("mpx-1")).toHaveClass("whitespace-normal");
    expect(within(table).getByText("Licence à confirmer : courbe non affichée.")).toHaveClass(
      "whitespace-normal",
    );
    expect(screen.getByText(/Autre : Référence à compléter\./)).toBeInTheDocument();
    expect(screen.queryByText(/À compléter/)).not.toBeInTheDocument();
    expect(screen.getByText(/Courbes de référence prétraitées \(modifiées\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/4.0/deed.fr",
    );
  });

  it("même version mais empreinte différente : Alert info", async () => {
    vi.mocked(getSpectralModel).mockResolvedValue({
      kind: "ok",
      info: { version: "s1", expected_sha256: "z".repeat(64) },
    } as never);
    await renderPage();
    expect(screen.getByText(/d'autres poids que ceux de la version s1/)).toBeInTheDocument();
  });

  it("version différente : Alert info", async () => {
    vi.mocked(getSpectralAnalysis).mockResolvedValue(analysis({}, { modelVersion: "s0" }) as never);
    await renderPage();
    expect(
      screen.getByText("Analyse faite avec la version s0 du modèle ; version actuelle : s1."),
    ).toBeInTheDocument();
  });

  it("un chercheur voit DecisionForm ; viewer et étude archivée non", async () => {
    await renderPage();
    expect(screen.getByRole("button", { name: "Enregistrer la décision" })).toBeInTheDocument();
  });

  it("viewer : pas de DecisionForm", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("viewer"));
    await renderPage();
    expect(screen.queryByRole("button", { name: "Enregistrer la décision" })).not.toBeInTheDocument();
  });

  it("étude archivée : pas de DecisionForm", async () => {
    vi.mocked(getSpectralAnalysis).mockResolvedValue(analysis({}, { archived: true }) as never);
    await renderPage();
    expect(screen.queryByRole("button", { name: "Enregistrer la décision" })).not.toBeInTheDocument();
  });

  it("dernière décision affichée avec son auteur et le nombre de décisions", async () => {
    vi.mocked(getSpectralAnalysis).mockResolvedValue(
      analysis(
        {},
        {
          decision: {
            id: "d1",
            decision: "corrected",
            polymer: "OTHER",
            polymerLabel: "Autre polymère",
            note: "Pic inhabituel.",
            decidedBy: "Bob",
            decidedAt: new Date("2026-10-02T10:00:00Z"),
            count: 2,
          },
        },
      ) as never,
    );
    await renderPage();
    const section = screen.getByRole("region", { name: "Décision" });
    expect(within(section).getByText("Corrigée", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(screen.getByText("Polymère retenu : Autre polymère")).toBeInTheDocument();
    expect(screen.getByText("Pic inhabituel.")).toBeInTheDocument();
    expect(screen.getByText(/par Bob/)).toHaveTextContent("(2 décisions, voir le Journal)");
  });

  it("graphique : h3, phrase avant le graphique, et « Voir les données » avec légende", async () => {
    await renderPage();
    const h3 = screen.getByRole("heading", { level: 3, name: "Spectre déposé et références" });
    const chart = screen.getByRole("img", { name: /Spectre déposé superposé/ });
    expect(
      h3.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/tracé tel qu'il le renvoie/)).toBeInTheDocument();
    expect(screen.getByText("Voir les données")).toBeInTheDocument();
    const data = screen.getByRole("table", { name: "Points tracés du graphique", hidden: true });
    // 2 points du spectre déposé + 2 de la seule référence affichable
    expect(within(data).getAllByRole("row", { hidden: true })).toHaveLength(1 + 4);
  });

  it("un seul h1, lien Toutes les analyses", async () => {
    await renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Toutes les analyses" })).toHaveAttribute(
      "href",
      "/labo/labo/etudes/s1/spectres",
    );
  });

  it("analyse introuvable : notFound", async () => {
    vi.mocked(getSpectralAnalysis).mockResolvedValue(null);
    await expect(
      AnalysisPage({ params: Promise.resolve({ labSlug: "labo", studyId: "s1", analysisId: "x" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
