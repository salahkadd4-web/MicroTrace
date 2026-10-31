import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({ requireLab: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/labo/labo/etudes/s1/qualite",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/studies", () => ({ getStudyView: vi.fn() }));
vi.mock("@/server/quality", () => ({ getStudyQuality: vi.fn() }));
vi.mock("../actions", () => ({ recordQualityDecisionAction: vi.fn() }));
vi.mock("@/server/engine/client", () => ({
  EngineUnavailableError: class EngineUnavailableError extends Error {},
  EngineError: class EngineError extends Error {
    constructor(
      readonly status: number,
      readonly detail: string,
    ) {
      super(detail);
    }
  },
}));

import { EngineError, EngineUnavailableError } from "@/server/engine/client";
import { requireLab } from "@/server/lab-context";
import { getStudyQuality } from "@/server/quality";
import { getStudyView } from "@/server/studies";
import StudyLayout from "../../layout";
import QualitePage from "../page";

const study = (archivedAt: Date | null = null) => ({
  id: "s1",
  title: "Étude Leslie",
  nature: "published" as const,
  archivedAt,
  project: { id: "p1", title: "Projet un" },
});

const asRole = (role: string) =>
  ({ userId: "u1", userName: "Alice", laboratoryId: "lab1", labSlug: "labo", labName: "Labo", role }) as never;

const GROUP = {
  polymer: "PE",
  method: "Py-GC/MS",
  matrix: "whole_blood",
  matrix_detail: "",
  kind: "mass_concentration",
  basis: "per_volume",
  canonical_unit: "ug/mL",
};

const ref = (over: object = {}) => ({
  import_id: "i1",
  file_sha256: "x",
  sheet: "",
  source_row: 29,
  source_column: "PE",
  sample_id: "16",
  aliquot: "a",
  status: "quantified",
  canonical_value: 7.1,
  canonical_unit: "ug/mL",
  ...over,
});

const KEY1 = "1".repeat(64);
const KEY2 = "2".repeat(64);

const signal1 = {
  key: KEY1,
  rule: "aliquot_discordance",
  category: "replicates",
  title: "Discordance entre aliquotes",
  subject_label: "Échantillon 16",
  explanation: "Les aliquotes de l'échantillon 16 diffèrent de 55,9 %.",
  group: GROUP,
  figures: [{ name: "gap", label: "Écart relatif", value: 0.559, unit: null }],
  records: [ref(), ref({ source_row: 30, aliquot: "b", status: "below_lod", canonical_value: null })],
};
const signal2 = {
  ...signal1,
  key: KEY2,
  rule: "robust_outlier",
  title: "Valeur atypique",
  subject_label: "Échantillon 4",
  explanation: "La valeur 3,6 s'écarte de la médiane.",
  figures: [{ name: "v", label: "Valeur", value: 3.6, unit: "ug/mL" }],
  records: [ref({ source_row: 8, canonical_value: 1234.5 })],
};

const decisionView = (over: object = {}) => ({
  id: "d1",
  signalKey: KEY1,
  decision: "justified",
  status: "rejected",
  note: "Aliquotes vérifiées au cahier.",
  decidedBy: "Bob",
  decidedAt: new Date("2026-10-01T10:00:00Z"),
  modelVersion: "q1",
  signal: signal1,
  count: 1,
  ...over,
});

const quality = (over: object = {}) =>
  ({
    kind: "ok",
    version: "q1",
    signals: [
      { signal: signal1, decision: decisionView() },
      { signal: signal2, decision: null },
    ],
    notes: [
      { rule: "near_blank", reason: "no_blank_summary", group: null, message: "Aucun contrôle de blanc : il en faut au moins 5." },
    ],
    rules: [
      { rule: "aliquot_discordance", title: "Discordance entre aliquotes", description: "Compare les aliquotes.", limits: ["Petit n peu fiable."] },
    ],
    disappeared: [],
    importNames: { i1: "mesures.csv" },
    mixedRulesVersions: false,
    contextChanged: false,
    archived: false,
    ...over,
  }) as never;

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1" });
  const page = await QualitePage({ params });
  render(await StudyLayout({ params, children: page }));
}

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue(asRole("researcher"));
  vi.mocked(getStudyView).mockResolvedValue(study() as never);
  vi.mocked(getStudyQuality).mockResolvedValue(quality());
});

describe("page Qualité", () => {
  it("l'onglet Qualité est le 4e lien, courant, et aucun autre lien ne contient Rapport ni Résultats", async () => {
    await renderPage();
    const tabs = within(screen.getByRole("navigation", { name: "Sections de l'étude" })).getAllByRole("link");
    expect(tabs[3]).toHaveTextContent("Qualité");
    expect(tabs[3]).toHaveAttribute("href", "/labo/labo/etudes/s1/qualite");
    expect(tabs[3]).toHaveAttribute("aria-current", "page");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Paramètres",
      "Imports",
      "Résultats",
      "Qualité",
      "Rapport",
      "Journal",
    ]);
    const others = screen
      .getAllByRole("link", { hidden: true })
      .filter((l) => !tabs.includes(l))
      .filter((l) => /Rapport|Résultats/.test(l.textContent ?? ""));
    expect(others).toHaveLength(0);
  });

  it("affiche le badge Règles d'essai, la version et la phrase d'essai", async () => {
    await renderPage();
    expect(screen.getByText("Règles d'essai")).toBeInTheDocument();
    expect(screen.getByText(/Version des règles : q1/)).toBeInTheDocument();
    expect(
      screen.getByText(/Règles documentées, appliquées à titre d'essai ; vos décisions ne servent à aucun entraînement pendant cette phase\./),
    ).toBeInTheDocument();
  });

  it("explication du moteur mot pour mot, h3 de règle et h4 du sujet, un seul h1", async () => {
    await renderPage();
    expect(screen.getByText("Les aliquotes de l'échantillon 16 diffèrent de 55,9 %.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 3, name: "Discordance entre aliquotes" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 3, name: "Valeur atypique" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Échantillon 16 — PE" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Échantillon 4 — PE" })).toBeInTheDocument();
    expect(screen.getByText("Écart relatif")).toBeInTheDocument();
  });

  it("mesure below_lod : « < LOD » et « — », sans nombre ; mesure quantifiée en fr-FR", async () => {
    await renderPage();
    const t1 = screen.getByRole("table", { hidden: true, name: /Mesures concernées — Échantillon 16/ });
    const rows = within(t1).getAllByRole("row", { hidden: true });
    expect(within(rows[1]).getByText("mesures.csv")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/^7,1/)).toBeInTheDocument();
    expect(within(rows[2]).getByText("< LOD")).toBeInTheDocument();
    expect(within(rows[2]).getByText("—", { selector: "td" })).toBeInTheDocument();
    const cells = within(rows[2]).getAllByRole("cell", { hidden: true });
    expect(cells.at(-1)).toHaveTextContent(/^—$/);
    const t2 = screen.getByRole("table", { hidden: true, name: /Mesures concernées — Échantillon 4/ });
    expect(within(t2).getByText(/^1234,5/)).toBeInTheDocument();
  });

  it("décision associée : badge, note, auteur ; sans décision : Non examiné", async () => {
    await renderPage();
    expect(
      screen.getAllByText("Examiné — justifié").some((e) => e.getAttribute("data-slot") === "badge"),
    ).toBe(true);
    expect(screen.getByText("Aliquotes vérifiées au cahier.")).toBeInTheDocument();
    expect(screen.getByText(/par Bob, le/)).toBeInTheDocument();
    expect(screen.getByText("Non examiné")).toBeInTheDocument();
  });

  it("décision « erreur de saisie » : phrase fixe et lien vers les imports pour un chercheur", async () => {
    vi.mocked(getStudyQuality).mockResolvedValue(
      quality({
        signals: [{ signal: signal1, decision: decisionView({ decision: "entry_error", status: "accepted" }) }],
      }),
    );
    await renderPage();
    expect(screen.getByText(/Cette décision ne modifie pas les résultats/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux imports" })).toHaveAttribute(
      "href",
      "/labo/labo/etudes/s1/imports",
    );
  });

  it("décision « erreur de saisie » : phrase sans lien pour un lecteur ; absente pour les autres décisions", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("viewer"));
    vi.mocked(getStudyQuality).mockResolvedValue(
      quality({
        signals: [{ signal: signal1, decision: decisionView({ decision: "entry_error", status: "accepted" }) }],
      }),
    );
    await renderPage();
    expect(screen.getByText(/Cette décision ne modifie pas les résultats/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Aller aux imports" })).not.toBeInTheDocument();
  });

  it("décision « justifié » : aucune phrase sur les résultats", async () => {
    await renderPage();
    expect(screen.queryByText(/ne modifie pas les résultats/)).not.toBeInTheDocument();
  });

  it("indique le nombre de décisions quand il y en a plusieurs", async () => {
    vi.mocked(getStudyQuality).mockResolvedValue(
      quality({ signals: [{ signal: signal1, decision: decisionView({ count: 3 }) }] }),
    );
    await renderPage();
    expect(screen.getByText("(3 décisions, voir le Journal)")).toBeInTheDocument();
  });

  it("Signaux disparus : règle, objet, version q1", async () => {
    vi.mocked(getStudyQuality).mockResolvedValue(
      quality({
        disappeared: [decisionView({ id: "d9", signalKey: "9".repeat(64), signal: { ...signal2, key: "9".repeat(64) } })],
      }),
    );
    await renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Signaux disparus" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /signal a disparu/ });
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getByText("Valeur atypique")).toBeInTheDocument();
    expect(within(row).getByText("Échantillon 4")).toBeInTheDocument();
    expect(within(row).getByText("q1")).toBeInTheDocument();
    expect(within(row).getByText("Bob")).toBeInTheDocument();
  });

  it("sans signaux disparus, pas de section", async () => {
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Signaux disparus" })).not.toBeInTheDocument();
  });

  it("notes et limites connues affichées", async () => {
    await renderPage();
    expect(screen.getByText(/il en faut au moins 5/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Règles de qualité (version q1)" })).toBeInTheDocument();
    expect(screen.getByText("Compare les aliquotes.")).toBeInTheDocument();
    expect(screen.getByText("Petit n peu fiable.")).toBeInTheDocument();
    expect(screen.getByText("Limites connues")).toBeInTheDocument();
  });

  it("un chercheur a un formulaire par signal", async () => {
    await renderPage();
    expect(screen.getAllByRole("button", { name: "Enregistrer la décision", hidden: true })).toHaveLength(2);
  });

  it("un viewer n'a aucun formulaire", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("viewer"));
    await renderPage();
    expect(screen.queryByText("Enregistrer une décision")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer la décision", hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText("Examiné — justifié")).toBeInTheDocument(); // badge seul : pas de radio
  });

  it("étude archivée : alerte de lecture seule, aucun formulaire", async () => {
    vi.mocked(getStudyQuality).mockResolvedValue(quality({ archived: true }));
    await renderPage();
    expect(screen.getByText("Étude archivée : les décisions sont en lecture seule.")).toBeInTheDocument();
    expect(screen.queryByText("Enregistrer une décision")).not.toBeInTheDocument();
  });

  it("avertissements de versions et de contexte", async () => {
    vi.mocked(getStudyQuality).mockResolvedValue(quality({ mixedRulesVersions: true, contextChanged: true }));
    await renderPage();
    expect(screen.getByText(/versions de règles différentes/)).toBeInTheDocument();
    expect(screen.getByText(/ont changé depuis certains imports/)).toBeInTheDocument();
  });

  it("aucun signal : phrase dédiée et notes toujours listées", async () => {
    vi.mocked(getStudyQuality).mockResolvedValue(quality({ signals: [] }));
    await renderPage();
    expect(screen.getByText(/Aucun signal avec les règles q1\./)).toBeInTheDocument();
    expect(screen.getByText(/il en faut au moins 5/)).toBeInTheDocument();
  });

  it("au plus 200 signaux par règle, avec la mention du reste", async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      signal: { ...signal1, key: i.toString(16).padStart(64, "0") },
      decision: null,
    }));
    vi.mocked(getStudyQuality).mockResolvedValue(quality({ signals: many }));
    await renderPage();
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(200);
    expect(screen.getByText("1 autres signaux non affichés.")).toBeInTheDocument();
  });

  it("état vide : NO_SAMPLE_MEASUREMENTS, puis les signaux disparus", async () => {
    vi.mocked(getStudyQuality).mockResolvedValue({ kind: "empty", disappeared: [decisionView()] } as never);
    await renderPage();
    expect(screen.getByText(/Aucune mesure d'échantillon dans les imports actifs/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Signaux disparus" })).toBeInTheDocument();
  });

  it("état vide : lien vers les imports pour un rôle d'écriture, pas pour un lecteur", async () => {
    vi.mocked(getStudyQuality).mockResolvedValue({ kind: "empty", disappeared: [] } as never);
    await renderPage();
    expect(screen.getByRole("link", { name: "Aller aux imports" })).toHaveAttribute(
      "href",
      "/labo/labo/etudes/s1/imports",
    );
  });

  it("état vide : pas de lien vers les imports pour un lecteur", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("viewer"));
    vi.mocked(getStudyQuality).mockResolvedValue({ kind: "empty", disappeared: [] } as never);
    await renderPage();
    expect(screen.queryByRole("link", { name: "Aller aux imports" })).not.toBeInTheDocument();
  });

  it("état vide sans décision : pas de section disparus", async () => {
    vi.mocked(getStudyQuality).mockResolvedValue({ kind: "empty", disappeared: [] } as never);
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Signaux disparus" })).not.toBeInTheDocument();
  });

  it("moteur indisponible : une seule alerte destructive, la page reste affichée", async () => {
    vi.mocked(getStudyQuality).mockRejectedValue(new EngineUnavailableError());
    await renderPage();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Le moteur d'analyse est indisponible.");
    expect(alerts[0].className).toMatch(/destructive/);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("refus du moteur : message fixe sans le détail ; 413 : message dédié", async () => {
    vi.mocked(getStudyQuality).mockRejectedValue(new EngineError(500, "détail interne secret"));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Le moteur d'analyse n'a pas pu calculer les signaux de qualité de cette étude.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
  });

  it("étude trop volumineuse (413)", async () => {
    vi.mocked(getStudyQuality).mockRejectedValue(new EngineError(413, "d"));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Étude trop volumineuse pour le calcul");
  });

  it("relance une erreur inattendue", async () => {
    vi.mocked(getStudyQuality).mockRejectedValue(new Error("boom"));
    await expect(QualitePage({ params: Promise.resolve({ labSlug: "labo", studyId: "s1" }) })).rejects.toThrow("boom");
  });

  it("n'écrit aucune couleur en dur dans les composants de la page", () => {
    const dir = __dirname + "/..";
    for (const f of ["page.tsx", "SignalCard.tsx", "DecisionForm.tsx", "actions.ts"]) {
      const src = readFileSync(`${dir}/${f}`, "utf8");
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
    }
  });
});
