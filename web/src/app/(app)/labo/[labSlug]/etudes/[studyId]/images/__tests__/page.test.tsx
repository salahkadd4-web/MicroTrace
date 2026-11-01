import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({ requireLab: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/labo/labo/etudes/s1/images",
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/studies", () => ({ getStudyView: vi.fn() }));
vi.mock("@/server/training-consent", () => ({ getTrainingConsent: vi.fn() }));
vi.mock("@/server/images", () => ({
  getImageModel: vi.fn(),
  listImageAnalyses: vi.fn(),
  listValidatedCounts: vi.fn(),
}));

import { requireLab } from "@/server/lab-context";
import { getImageModel, listImageAnalyses, listValidatedCounts } from "@/server/images";
import { getStudyView } from "@/server/studies";
import { getTrainingConsent } from "@/server/training-consent";
import StudyLayout from "../../layout";
import ImagesPage from "../page";

const study = (archivedAt: Date | null = null) => ({
  id: "s1",
  title: "Étude Leslie",
  nature: "published" as const,
  archivedAt,
  project: { id: "p1", title: "Projet un" },
});
const asRole = (role: string) =>
  ({ userId: "u1", userName: "Alice", laboratoryId: "lab1", labSlug: "labo", labName: "Labo", role }) as never;

const TRIAL = "Modèle d'essai : entraîné sur des images publiques de microscopie électronique, pas encore sur les vôtres.";
const info = (over: object = {}) => ({
  available: true,
  reason: null,
  message: null,
  name: "c6-microscopie",
  version: "i1",
  expected_sha256: "a",
  sha256: "a",
  trial_label: "Modèle d'essai",
  trial_sentence: TRIAL,
  limits: [
    TRIAL,
    "Entraîné et évalué sur des images MEB seulement : sur une image de microscopie optique, ses performances sont inconnues.",
    "Le modèle n'a pas vu de particules extraites de sang.",
    "L'image ne dit pas si une particule est un plastique : seule une méthode chimique le peut.",
  ],
  card_path: "docs/models/c6-microscopie.md",
  max_bytes: 26214400,
  max_pixels: 40000000,
  analysis_max_side: 1024,
  shape_vocabulary: [
    { code: "fibre", label: "Fibre", evaluated: true },
    { code: "fragment", label: "Fragment", evaluated: true },
    { code: "bille", label: "Bille", evaluated: true },
    { code: "film", label: "Film", evaluated: false },
  ],
  thresholds: { pixel: 0.7, min_area_frac: 0.005, shape_min_score: 0.6, max_foreground: 0.25, min_contrast: 10 },
  metrics: {
    test_images: 42,
    f1_objects: 0.49,
    count_mae: 2.0,
    dice: 0.709,
    shape_balanced_accuracy: 0.93,
    unreliable_share: 0.1667,
  },
  training_data: "dataset3 : 237 images MEB, licence à confirmer",
  ...over,
});

const row = (over: object = {}) => ({
  id: "an1",
  createdAt: new Date("2026-10-01T10:00:00Z"),
  fileName: "Rapport Résultats.tif",
  status: "proposal",
  statusLabel: "Proposition",
  count: 5,
  scaleSource: "entered",
  scaleSourceLabel: "saisie",
  modelVersion: "i1",
  decision: null,
  ...over,
});

const counted = (over: object = {}) => ({
  analysisId: "an1",
  decisionId: "d1",
  decidedAt: new Date("2026-10-02T10:00:00Z"),
  decision: "corrected",
  validated: {
    count: 7,
    kept: 5,
    excluded: 1,
    missed: 2,
    count_by_shape: [
      { shape: "fibre", label: "Fibre", count: 3 },
      { shape: "fragment", label: "Fragment", count: 1 },
      { shape: "bille", label: "Bille", count: 1 },
      { shape: "film", label: "Film", count: 0 },
      { shape: "unspecified", label: "Forme non renseignée", count: 2 },
    ],
    size_distribution: null,
    changes: 0,
    sentence: "x",
  },
  medianFeretUm: 18.5,
  ...over,
});

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1" });
  const page = await ImagesPage({ params });
  render(await StudyLayout({ params, children: page }));
}

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue(asRole("researcher"));
  vi.mocked(getStudyView).mockResolvedValue(study() as never);
  vi.mocked(getImageModel).mockResolvedValue({ kind: "ok", info: info() } as never);
  vi.mocked(listImageAnalyses).mockResolvedValue({ rows: [row()], hidden: 0 } as never);
  vi.mocked(listValidatedCounts).mockResolvedValue([counted()] as never);
  vi.mocked(getTrainingConsent).mockResolvedValue({
    granted: false, grantedAt: null, grantedBy: null, version: null, history: [],
  });
});

describe("page Images", () => {
  it("Alert info : badge, phrase d'essai une seule fois, limites du moteur", async () => {
    await renderPage();
    const alert = screen
      .getAllByRole("alert")
      .find((a) => a.textContent?.includes("Version du modèle : i1"))!;
    expect(within(alert).getByText("Modèle d'essai")).toBeInTheDocument();
    expect(alert).toHaveTextContent(TRIAL);
    expect(screen.getAllByText(TRIAL)).toHaveLength(1);
    expect(alert).toHaveTextContent("images MEB seulement");
    expect(alert).toHaveTextContent("ne dit pas si une particule est un plastique");
  });

  it("consentement en lecture seule", async () => {
    await renderPage();
    expect(screen.getByText(/améliorer les modèles : désactivée\./)).toBeInTheDocument();
  });

  it("un chercheur voit le formulaire ; un lecteur non ; une étude archivée non", async () => {
    await renderPage();
    expect(screen.getByLabelText("Image de microscopie")).toBeInTheDocument();
    cleanup();
    vi.mocked(requireLab).mockResolvedValue(asRole("viewer"));
    await renderPage();
    expect(screen.queryByLabelText("Image de microscopie")).not.toBeInTheDocument();
    cleanup();
    vi.mocked(requireLab).mockResolvedValue(asRole("researcher"));
    vi.mocked(getStudyView).mockResolvedValue(study(new Date("2026-04-01T00:00:00Z")) as never);
    await renderPage();
    expect(
      screen.getByText("Étude archivée : les analyses et décisions sont en lecture seule."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Image de microscopie")).not.toBeInTheDocument();
  });

  it("modèle indisponible : une seule alerte destructive, pas de formulaire, table conservée", async () => {
    vi.mocked(getImageModel).mockResolvedValue({
      kind: "unavailable",
      info: info({ available: false, reason: "missing", message: "Modèle d'images absent : lancez l'entraînement." }),
    } as never);
    await renderPage();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Le modèle d'images n'est pas installé : contactez l'équipe MicroTrace.");
    expect(alerts[0]).not.toHaveTextContent("lancez l'entraînement");
    expect(screen.queryByLabelText("Image de microscopie")).not.toBeInTheDocument();
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
  });

  it("moteur injoignable : ENGINE_DOWN, pas de formulaire, pas d'erreur", async () => {
    vi.mocked(getImageModel).mockResolvedValue({ kind: "engine_down" });
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Le moteur d'analyse est indisponible.");
    expect(screen.queryByLabelText("Image de microscopie")).not.toBeInTheDocument();
    expect(screen.getByText(/améliorer les modèles/)).toBeInTheDocument();
  });

  it("aucune analyse : état vide", async () => {
    vi.mocked(listImageAnalyses).mockResolvedValue({ rows: [], hidden: 0 });
    await renderPage();
    expect(screen.getByText("Aucune image analysée dans cette étude.")).toBeInTheDocument();
  });

  it("un fichier « Rapport Résultats.tif » ne crée aucun lien Rapport ou Résultats", async () => {
    await renderPage();
    const table = screen.getByRole("table", { name: "Analyses d'images de l'étude" });
    const links = within(table).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Voir");
    expect(links[0]).toHaveAttribute("aria-label", "Ouvrir l'analyse du 01/10/2026 12:00");
    expect(links[0]).toHaveAttribute("href", "/labo/labo/etudes/s1/images/an1");
    expect(screen.getAllByRole("link", { name: /Rapport/ })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /Résultats/ })).toHaveLength(1);
  });

  it("tableau : Statut et Décision visibles, action collée à droite", async () => {
    await renderPage();
    const table = screen.getByRole("table", { name: "Analyses d'images de l'étude" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Date", "Fichier", "Statut", "Particules proposées", "Échelle", "Décision", "Actions",
    ]);
    const cells = within(table).getAllByRole("cell");
    expect(cells[1]).toHaveClass("whitespace-normal", "min-w-32");
    expect(cells[2]).toHaveClass("whitespace-normal");
    expect(cells[5]).toHaveClass("whitespace-normal");
    expect(cells[6]).toHaveClass("sticky", "right-0", "bg-card");
  });

  it("comptages validés : phrase, lien CSV, colonnes, aucune ligne de total", async () => {
    await renderPage();
    const section = screen.getByRole("region", {
      name: "Comptage de particules candidates (images validées)",
    });
    expect(section).toHaveTextContent("Ils ne figurent ni dans Résultats ni dans le rapport.");
    expect(within(section).getByRole("link", { name: "Télécharger les comptages (CSV)" })).toHaveAttribute(
      "href",
      "/labo/labo/etudes/s1/images/comptages",
    );
    const table = within(section).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(table).toHaveTextContent("18,5 µm");
    expect(within(table).queryByText(/total/i)).not.toBeInTheDocument();
    expect(within(section).getByRole("link", { name: /Ouvrir l'analyse validée/ })).toBeInTheDocument();
  });

  it("comptages : échelle inconnue", async () => {
    vi.mocked(listValidatedCounts).mockResolvedValue([counted({ medianFeretUm: null })] as never);
    await renderPage();
    expect(screen.getByText("échelle inconnue")).toBeInTheDocument();
  });

  it("fiche du modèle : chiffres en français, formes évaluées et non évaluées, sous-ensemble de test", async () => {
    await renderPage();
    const card = screen.getByRole("region", { name: "Fiche du modèle (version i1)" });
    expect(card).toHaveTextContent("docs/models/c6-microscopie.md");
    expect(card).toHaveTextContent("Formes évaluéesFibre, Fragment, Bille");
    expect(card).toHaveTextContent("Film : forme non évaluée dans cette version");
    expect(card).toHaveTextContent("42 images MEB");
    expect(card).toHaveTextContent("0,49");
    expect(card).toHaveTextContent("2,0 particules par image");
    expect(card).toHaveTextContent("93 %");
    expect(card).toHaveTextContent("16,7 %");
    expect(card).toHaveTextContent("score de 0,60");
    expect(card).toHaveTextContent("dataset3 : 237 images MEB, licence à confirmer");
    expect(card).not.toHaveTextContent("0.49");
  });

  it("aucun champ ni bouton dans l'en-tête, les onglets ou le bandeau", async () => {
    await renderPage();
    expect(within(screen.getByRole("navigation", { name: "Sections de l'étude" })).queryByRole("button")).toBeNull();
  });

  it("aucune couleur en dur dans les fichiers de images/", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) return n === "__tests__" ? [] : walk(p);
        return /\.(tsx?|css)$/.test(n) ? [p] : [];
      });
    const files = walk(join(__dirname, ".."));
    expect(files.length).toBeGreaterThan(6);
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
    }
  });
});
