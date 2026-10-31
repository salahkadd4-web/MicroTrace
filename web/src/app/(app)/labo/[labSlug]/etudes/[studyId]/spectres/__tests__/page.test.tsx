import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({ requireLab: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/labo/labo/etudes/s1/spectres",
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/studies", () => ({ getStudyView: vi.fn() }));
vi.mock("@/server/training-consent", () => ({ getTrainingConsent: vi.fn() }));
vi.mock("@/server/spectral", () => ({
  getSpectralModel: vi.fn(),
  listSpectralAnalyses: vi.fn(),
}));

import { requireLab } from "@/server/lab-context";
import { getTrainingConsent } from "@/server/training-consent";
import { getSpectralModel, listSpectralAnalyses } from "@/server/spectral";
import { getStudyView } from "@/server/studies";
import StudyLayout from "../../layout";
import SpectresPage from "../page";

const study = (archivedAt: Date | null = null) => ({
  id: "s1",
  title: "Étude Leslie",
  nature: "published" as const,
  archivedAt,
  project: { id: "p1", title: "Projet un" },
});
const asRole = (role: string) =>
  ({ userId: "u1", userName: "Alice", laboratoryId: "lab1", labSlug: "labo", labName: "Labo", role }) as never;

const THRESHOLDS = {
  uncertain_min_score: 0.5,
  identified_min_score: 0.8,
  identified_min_margin: 0.05,
  classifier_agreement_required: true,
};
const info = (over: object = {}) => ({
  available: true,
  reason: null,
  message: null,
  name: "spectral",
  version: "s1",
  expected_sha256: "a",
  sha256: "a",
  trial_label: "Modèle d'essai",
  trial_sentence: "Modèle d'essai : entraîné sur des données publiques, pas encore sur les vôtres.",
  limits: [
    "Le modèle n'a pas vu de particules extraites de sang.",
    "Il n'y a pas de classe non plastique dans cette version.",
  ],
  card_path: "docs/models/c5-spectral.md",
  max_bytes: 2097152,
  max_points: 20000,
  techniques: [
    {
      technique: "raman",
      label: "Raman",
      n_references: 120,
      polymers: [
        { code: "PE", label: "Polyéthylène" },
        { code: "PP", label: "Polypropylène" },
      ],
      window_min: 600,
      window_max: 1800,
      thresholds: THRESHOLDS,
      metrics: {
        n: 100,
        n_in_library: 90,
        n_out_of_library: 10,
        top1: 0.9,
        top3: 0.97,
        status_in_library: { identified: 0.6, uncertain: 0.2, not_identified: 0.2 },
        status_out_of_library: null,
        nested_identified_precision_min: 0.95,
        nested_identified_precision_max: 0.99,
      },
    },
  ],
  libraries: [
    {
      code: "microplastix",
      name: "MicroPlastiX",
      citation: "Citation MicroPlastiX.",
      licence_text: "CC BY 4.0",
      curve_allowed: true,
      n_ftir_atr: 10,
      n_raman: 20,
    },
    {
      code: "other",
      name: "Autre bibliothèque",
      citation: "Citation autre.",
      licence_text: "À confirmer",
      curve_allowed: false,
      n_ftir_atr: 5,
      n_raman: 5,
    },
  ],
  ...over,
});

const row = (over: object = {}) => ({
  id: "an1",
  createdAt: new Date("2026-10-01T10:00:00Z"),
  fileName: "Rapport Résultats.csv",
  techniqueLabel: "Raman",
  status: "identified",
  statusLabel: "Identifié (proposition)",
  proposedLabel: "Polyéthylène",
  modelVersion: "s1",
  decision: null,
  ...over,
});

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1" });
  const page = await SpectresPage({ params });
  render(await StudyLayout({ params, children: page }));
}

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue(asRole("researcher"));
  vi.mocked(getStudyView).mockResolvedValue(study() as never);
  vi.mocked(getSpectralModel).mockResolvedValue({ kind: "ok", info: info() } as never);
  vi.mocked(listSpectralAnalyses).mockResolvedValue({ rows: [row()], hidden: 0 } as never);
  vi.mocked(getTrainingConsent).mockResolvedValue({
    granted: false, grantedAt: null, grantedBy: null, version: null, history: [],
  });
});

describe("page Spectres", () => {
  it("Alert info : badge Modèle d'essai, phrase d'essai mot pour mot et limites du moteur", async () => {
    await renderPage();
    const alert = screen
      .getAllByRole("alert")
      .find((a) => a.textContent?.includes("Version du modèle : s1"))!;
    expect(within(alert).getByText("Modèle d'essai")).toBeInTheDocument();
    expect(alert).toHaveTextContent(
      "Modèle d'essai : entraîné sur des données publiques, pas encore sur les vôtres.",
    );
    expect(alert).toHaveTextContent("n'a pas vu de particules extraites de sang");
    expect(alert).toHaveTextContent("pas de classe non plastique dans cette version");
  });

  it("consentement du laboratoire en lecture seule : désactivé, puis activé avec la date", async () => {
    await renderPage();
    expect(
      screen.getByText(
        "Utilisation des données validées de ce laboratoire pour améliorer les modèles : désactivée.",
      ),
    ).toBeInTheDocument();
    cleanup();
    vi.mocked(getTrainingConsent).mockResolvedValue({
      granted: true, grantedAt: new Date("2026-10-02T10:00:00Z"), grantedBy: "Alice", version: "c1", history: [],
    });
    await renderPage();
    expect(
      screen.getByText(
        "Utilisation des données validées de ce laboratoire pour améliorer les modèles : activée depuis le 02/10/2026 12:00 (réglage du responsable du laboratoire).",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /consentement/i })).not.toBeInTheDocument();
  });

  it("un chercheur voit le formulaire de dépôt", async () => {
    await renderPage();
    expect(screen.getByLabelText("Fichier du spectre")).toBeInTheDocument();
  });

  it("viewer : aucun formulaire", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("viewer"));
    await renderPage();
    expect(screen.queryByLabelText("Fichier du spectre")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyser le spectre" })).not.toBeInTheDocument();
  });

  it("étude archivée : lecture seule, aucun formulaire", async () => {
    vi.mocked(getStudyView).mockResolvedValue(study(new Date("2026-04-01T00:00:00Z")) as never);
    await renderPage();
    expect(
      screen.getByText("Étude archivée : les analyses et décisions sont en lecture seule."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Fichier du spectre")).not.toBeInTheDocument();
  });

  it("modèle indisponible : une seule alerte destructive avec le message, pas de formulaire, la table reste", async () => {
    vi.mocked(getSpectralModel).mockResolvedValue({
      kind: "unavailable",
      info: info({ available: false, reason: "missing", message: "Modèle spectral absent : lancez l'entraînement." }),
    } as never);
    await renderPage();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Modèle spectral absent : lancez l'entraînement.");
    expect(screen.queryByLabelText("Fichier du spectre")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("moteur injoignable : ENGINE_DOWN, pas de formulaire, pas d'erreur", async () => {
    vi.mocked(getSpectralModel).mockResolvedValue({ kind: "engine_down" });
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Le moteur d'analyse est indisponible.");
    expect(screen.queryByLabelText("Fichier du spectre")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("aucune analyse : état vide", async () => {
    vi.mocked(listSpectralAnalyses).mockResolvedValue({ rows: [], hidden: 0 });
    await renderPage();
    expect(screen.getByText("Aucun spectre analysé dans cette étude.")).toBeInTheDocument();
  });

  it("un fichier « Rapport Résultats.csv » ne crée aucun lien Rapport ou Résultats ; lien Voir", async () => {
    await renderPage();
    const tableLinks = within(screen.getByRole("table")).getAllByRole("link");
    expect(tableLinks).toHaveLength(1);
    expect(tableLinks[0]).toHaveTextContent("Voir");
    expect(tableLinks[0]).toHaveAttribute("aria-label", "Ouvrir l'analyse du 01/10/2026 12:00");
    expect(tableLinks[0]).toHaveAttribute("href", "/labo/labo/etudes/s1/spectres/an1");
    // Seuls les onglets portent ces mots : un lien « Rapport » et un lien « Résultats », pas davantage.
    expect(screen.getAllByRole("link", { name: /Rapport/ })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /Résultats/ })).toHaveLength(1);
  });

  it("fiche du modèle : bibliothèques et chemin de la fiche", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Fiche du modèle (version s1)" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Fiche du modèle (version s1)" });
    expect(card).toHaveTextContent("MicroPlastiX");
    expect(card).toHaveTextContent("Autre bibliothèque");
    expect(screen.getByText(/docs\/models\/c5-spectral\.md/)).toBeInTheDocument();
  });

  it("aucun champ ni bouton dans l'en-tête, les onglets ou le bandeau", async () => {
    await renderPage();
    expect(within(screen.getByRole("navigation", { name: "Sections de l'étude" })).queryByRole("button")).toBeNull();
  });

  it("aucune couleur en dur dans les fichiers de spectres/", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) return n === "__tests__" ? [] : walk(p);
        return /\.(tsx?|css)$/.test(n) ? [p] : [];
      });
    const files = walk(join(__dirname, ".."));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
    }
  });
});
