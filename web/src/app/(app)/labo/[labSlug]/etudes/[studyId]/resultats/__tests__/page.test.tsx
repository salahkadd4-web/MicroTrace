import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({ requireLab: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/labo/labo/etudes/s1/resultats",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/studies", () => ({ getStudyView: vi.fn() }));
vi.mock("@/server/results", () => ({ getStudyResults: vi.fn() }));
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
// jsdom n'a pas de mise en page : le conteneur adaptatif ne dessine rien. On teste les tableaux.
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: () => null };
});

import { EngineError, EngineUnavailableError } from "@/server/engine/client";
import { requireLab } from "@/server/lab-context";
import { getStudyResults } from "@/server/results";
import { getStudyView } from "@/server/studies";
import StudyLayout from "../../layout";
import ResultatsPage from "../page";

const study = (archivedAt: Date | null = null) => ({
  id: "s1",
  title: "Étude Leslie",
  nature: "published" as const,
  archivedAt,
  project: { id: "p1", title: "Projet un" },
});

const asRole = (role: string) =>
  ({ userId: "u1", userName: "Alice", laboratoryId: "lab1", labSlug: "labo", labName: "Labo", role }) as never;

const G = {
  method: "Py-GC/MS",
  matrix: "whole_blood",
  matrix_detail: "",
  kind: "mass_concentration",
  basis: "per_volume",
  canonical_unit: "ug/mL",
};

const results = (over: object = {}) =>
  ({
    empty: false,
    summary: {
      aggregation_rule: "Médiane des aliquots quantifiés par échantillon.",
      frequencies: [
        { polymer: "PS_SUM", matrix: "whole_blood", matrix_detail: "", n_samples: 22, n_quantified: 11, fraction: 0.5 },
        { polymer: "ANY", matrix: "whole_blood", matrix_detail: "", n_samples: 22, n_quantified: 20, fraction: 0.9090909 },
        { polymer: "PET", matrix: "plasma", matrix_detail: "", n_samples: 4, n_quantified: 1, fraction: 0.25 },
      ],
      stats: [
        {
          polymer: "PS_SUM", ...G, n_quantified: 11, min: 1.5, median: 2.4, mean: 3.1, max: 9.25,
          max_measurement: 9.25, counts_by_status: { quantified: 11, below_lod: 7, not_quantified: 4 },
        },
        {
          polymer: "PS_SUM", ...G, method: "Micro-FTIR", canonical_unit: "particles/mL", kind: "number_concentration",
          n_quantified: 2, min: 1, median: 2, mean: 2, max: 3, max_measurement: 3,
          counts_by_status: { quantified: 2 },
        },
      ],
      samples: [
        { sample_id: "D01", polymer: "PS_SUM", ...G, status: "quantified", value: 2.4, n_aliquots: 1, n_quantified: 1 },
        { sample_id: "D02", polymer: "PS_SUM", ...G, status: "below_lod", value: null, n_aliquots: 1, n_quantified: 0 },
        { sample_id: "D03", polymer: "PS_SUM", ...G, method: "Micro-FTIR", canonical_unit: "particles/mL", kind: "number_concentration", status: "quantified", value: 3, n_aliquots: 1, n_quantified: 1 },
      ],
    },
    imports: [
      { id: "i1", fileName: "a.csv", sha256: "x", rulesVersion: "1", createdAt: new Date(), author: "Alice" },
    ],
    mixedRulesVersions: false,
    contextChanged: false,
    nature: "published",
    ...over,
  }) as never;

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1" });
  const page = await ResultatsPage({ params });
  render(await StudyLayout({ params, children: page }));
}

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue(asRole("viewer"));
  vi.mocked(getStudyView).mockResolvedValue(study() as never);
  vi.mocked(getStudyResults).mockResolvedValue(results());
});

describe("page Résultats", () => {
  it("affiche les fréquences « 11/22 » et « 50 % » issues du moteur, avec libellés de polymères", async () => {
    await renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const table = screen.getByRole("table", { name: /Fréquences de quantification.*Sang total/ });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("PS (somme)")).toBeInTheDocument();
    expect(within(rows[1]).getByText("11/22")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/^50\s%$/)).toBeInTheDocument();
    expect(within(rows[2]).getByText("Au moins un polymère")).toBeInTheDocument();
    expect(within(rows[2]).getByText(/^90,9\s%$/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Fréquences de quantification.*Plasma/ })).toBeInTheDocument();
  });

  it("affiche la règle d'agrégation telle quelle", async () => {
    await renderPage();
    expect(screen.getByText("Médiane des aliquots quantifiés par échantillon.")).toBeInTheDocument();
  });

  it("ne fusionne jamais les groupes : un tableau de statistiques par groupe, avec unité", async () => {
    await renderPage();
    const t1 = screen.getByRole("table", { name: /Statistiques.*Py-GC\/MS.*µg\/mL/ });
    const t2 = screen.getByRole("table", { name: /Statistiques.*Micro-FTIR.*particles\/mL/ });
    expect(within(t1).getByText("2,4")).toBeInTheDocument();
    expect(within(t1).getByText("9,25")).toBeInTheDocument();
    expect(within(t1).getByRole("columnheader", { name: /Médiane.*µg\/mL/ })).toBeInTheDocument();
    expect(within(t2).queryByText("2,4")).not.toBeInTheDocument();
    expect(within(t1).getByText("7")).toBeInTheDocument();
  });

  it("chaque graphique a un titre h3, une phrase et un tableau de données équivalent", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { level: 3, name: /Fréquence de quantification par polymère.*Sang total/ }),
    ).toBeInTheDocument();
    const points = screen.getAllByRole("heading", { level: 3, name: /Valeurs par échantillon/ });
    expect(points).toHaveLength(2);
    const data = screen.getByRole("table", { hidden: true, name: /Données des valeurs.*Py-GC\/MS/ });
    expect(within(data).getByText("D01")).toBeInTheDocument();
    expect(within(data).queryByText("D02")).not.toBeInTheDocument(); // non quantifié : jamais tracé
    expect(screen.getAllByText(/Seuls les échantillons quantifiés sont tracés/).length).toBe(2);
  });

  it("avertit si les versions de règles diffèrent", async () => {
    vi.mocked(getStudyResults).mockResolvedValue(results({ mixedRulesVersions: true }));
    await renderPage();
    expect(screen.getByText(/versions de règles différentes/)).toBeInTheDocument();
  });

  it("avertit si les paramètres ont changé depuis certains imports (texte exact)", async () => {
    vi.mocked(getStudyResults).mockResolvedValue(results({ contextChanged: true }));
    await renderPage();
    expect(
      screen.getByText(
        "Les paramètres de l'étude (méthodes ou limites) ont changé depuis certains imports : les statuts restent ceux calculés lors de chaque import.",
      ),
    ).toBeInTheDocument();
  });

  it("n'affiche aucun avertissement quand tout est cohérent", async () => {
    await renderPage();
    expect(screen.queryByText(/versions de règles différentes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ont changé depuis certains imports/)).not.toBeInTheDocument();
  });

  it("état vide avec lien vers Imports pour un chercheur", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("researcher"));
    vi.mocked(getStudyResults).mockResolvedValue({ empty: true } as never);
    await renderPage();
    expect(
      screen.getByText("Aucune mesure d'échantillon dans les imports actifs : importez un fichier de mesures pour voir les résultats."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux imports" })).toHaveAttribute(
      "href",
      "/labo/labo/etudes/s1/imports",
    );
  });

  it("état vide sans lien pour un lecteur", async () => {
    vi.mocked(getStudyResults).mockResolvedValue({ empty: true } as never);
    await renderPage();
    expect(screen.getByText(/Aucune mesure d'échantillon dans les imports actifs/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Aller aux imports" })).not.toBeInTheDocument();
  });

  it("moteur indisponible : message français dans une alerte, la page reste affichée", async () => {
    vi.mocked(getStudyResults).mockRejectedValue(new EngineUnavailableError());
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Le moteur d'analyse est indisponible.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("refus du moteur : message fixe, jamais le détail, la page reste affichée", async () => {
    vi.mocked(getStudyResults).mockRejectedValue(new EngineError(500, "détail interne secret"));
    await renderPage();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Le moteur d'analyse n'a pas pu calculer les résultats de cette étude.",
    );
    expect(alert).not.toHaveTextContent("secret");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("étude trop volumineuse (413 du moteur) : message dédié", async () => {
    vi.mocked(getStudyResults).mockRejectedValue(new EngineError(413, "detail"));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Étude trop volumineuse pour le calcul : retirez un import ou scindez l'étude.",
    );
  });

  it("mêmes nombres que le rapport : 1/16 -> 6,2 %, moyenne à 6 chiffres significatifs, sans séparateur de milliers", async () => {
    const base = results() as unknown as { summary: { frequencies: object[]; stats: object[] } };
    base.summary.frequencies = [
      { polymer: "PET", matrix: "whole_blood", matrix_detail: "", n_samples: 16, n_quantified: 1, fraction: 0.0625 },
      { polymer: "PE", matrix: "whole_blood", matrix_detail: "", n_samples: 16, n_quantified: 5, fraction: 0.3125 },
    ];
    base.summary.stats = [
      {
        polymer: "PET", ...G, n_quantified: 1234, min: 1.8433333, median: 1234.56789, mean: 1234567,
        max: 0.00001234, max_measurement: 1, counts_by_status: { quantified: 1234 },
      },
    ];
    vi.mocked(getStudyResults).mockResolvedValue(base as never);
    await renderPage();
    const freq = screen.getByRole("table", { name: /Fréquences de quantification/ });
    expect(within(freq).getByText(/^6,2\s%$/)).toBeInTheDocument();
    expect(within(freq).getByText(/^31,2\s%$/)).toBeInTheDocument();
    const stats = screen.getByRole("table", { name: /Statistiques/ });
    for (const text of ["1,84333", "1234,57", "1234567", "0,00001234", "1234"]) {
      expect(within(stats).getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  it("tableau « Voir les données » : 500 lignes au plus, avec la mention du total", async () => {
    const many = results() as unknown as { summary: { samples: object[] } };
    many.summary.samples = Array.from({ length: 501 }, (_, i) => ({
      sample_id: `S${i}`, polymer: "PS_SUM", ...G, status: "quantified", value: 1, n_aliquots: 1, n_quantified: 1,
    }));
    vi.mocked(getStudyResults).mockResolvedValue(many as never);
    await renderPage();
    const table = screen.getByRole("table", { name: /Données des valeurs par échantillon/, hidden: true });
    expect(within(table).getAllByRole("row", { hidden: true })).toHaveLength(501); // en-tête + 500
    expect(
      screen.getByText("500 premières lignes sur 501 — téléchargez le CSV pour tout voir."),
    ).toBeInTheDocument();
  });

  it("relance une erreur inattendue", async () => {
    vi.mocked(getStudyResults).mockRejectedValue(new Error("boom"));
    await expect(
      ResultatsPage({ params: Promise.resolve({ labSlug: "labo", studyId: "s1" }) }),
    ).rejects.toThrow("boom");
  });

  it("étude introuvable (autre laboratoire) : 404 comme les autres onglets", async () => {
    vi.mocked(getStudyView).mockResolvedValue(null as never);
    await expect(
      ResultatsPage({ params: Promise.resolve({ labSlug: "labo", studyId: "s9" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("une étude archivée reste consultable", async () => {
    vi.mocked(getStudyView).mockResolvedValue(study(new Date("2026-04-01T00:00:00Z")) as never);
    await renderPage();
    expect(screen.getByText("Médiane des aliquots quantifiés par échantillon.")).toBeInTheDocument();
  });

  it("n'écrit aucune couleur en dur dans les composants de la page", () => {
    const dir = __dirname + "/..";
    for (const f of ["page.tsx", "ResultCharts.tsx"]) {
      const src = readFileSync(`${dir}/${f}`, "utf8");
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
    }
  });
});
