import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({ requireLab: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/labo/labo/etudes/s1/imports",
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/studies", () => ({ getStudyView: vi.fn() }));
vi.mock("@/server/imports", () => ({ listImports: vi.fn() }));
vi.mock("@/server/engine/client", () => ({ engineClient: { dictionary: vi.fn() } }));
vi.mock("../actions", () => ({
  suggestMappingAction: vi.fn(),
  checkImportAction: vi.fn(),
  saveImportAction: vi.fn(),
  retireImportAction: vi.fn(),
  importIssuesAction: vi.fn(),
}));

import { engineClient } from "@/server/engine/client";
import { listImports } from "@/server/imports";
import { requireLab } from "@/server/lab-context";
import { getStudyView } from "@/server/studies";
import StudyLayout from "../../layout";
import ImportsPage from "../page";

const CSV =
  "name,label_fr,type,required,description_fr,allowed\n" +
  "sample_id,Identifiant d'échantillon,text,yes,Identifiant.,\n" +
  "polymer,Polymère,text,yes,Polymère mesuré.,\n";

const run = (over: object) => ({
  id: "r1",
  status: "active",
  sheet: null,
  errorCount: 0,
  warningCount: 2,
  infoCount: 1,
  warningsAccepted: true,
  retiredReason: null,
  retiredAt: null,
  rulesVersion: "1",
  createdAt: new Date("2026-03-02T10:00:00Z"),
  fileName: "mesures.csv",
  sizeBytes: 100,
  measurementCount: 1200,
  qcMeasurementCount: 3,
  createdByName: "Alice Martin",
  ...over,
});

const study = (archivedAt: Date | null) => ({
  id: "s1",
  title: "Étude Leslie",
  nature: "published" as const,
  archivedAt,
  project: { id: "p1", title: "Projet un" },
  methods: [],
  limits: [],
  qcSummaries: [],
});

const asRole = (role: string) =>
  ({ userId: "u1", userName: "Alice", laboratoryId: "lab1", labSlug: "labo", labName: "Labo", role }) as never;

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1" });
  const page = await ImportsPage({ params });
  render(await StudyLayout({ params, children: page }));
}

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue(asRole("researcher"));
  vi.mocked(getStudyView).mockResolvedValue(study(null) as never);
  vi.mocked(engineClient.dictionary).mockResolvedValue({ csv: CSV, markdown: "# D" });
  vi.mocked(listImports).mockResolvedValue([
    run({}),
    run({
      id: "r2",
      status: "retired",
      retiredReason: "Mauvais fichier",
      retiredAt: new Date("2026-03-03T09:00:00Z"),
      fileName: "ancien.csv",
    }),
  ] as never);
});

describe("page Imports", () => {
  it("liste les imports avec statut, motif et un seul h1", async () => {
    await renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("mesures.csv")).toBeInTheDocument();
    expect(screen.getAllByText("Alice Martin").length).toBeGreaterThan(0);
    expect(screen.getByText("Actif")).toBeInTheDocument();
    expect(screen.getByText("Retiré")).toBeInTheDocument();
    expect(screen.getByText(/Mauvais fichier/)).toBeInTheDocument();
    expect(screen.getAllByText("1 203").length).toBeGreaterThan(0);
  });

  it("un chercheur voit l'assistant et « Retirer » seulement sur l'import actif", async () => {
    await renderPage();
    expect(screen.getByLabelText("Fichier à importer")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Retirer" })).toHaveLength(1);
  });

  it("un lecteur ne voit ni l'assistant ni « Retirer »", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("viewer"));
    await renderPage();
    expect(screen.queryByLabelText("Fichier à importer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retirer" })).not.toBeInTheDocument();
    expect(screen.queryByText("1. Dépôt")).not.toBeInTheDocument();
    expect(screen.getByText("mesures.csv")).toBeInTheDocument();
  });

  it("une étude archivée est en lecture seule, avec l'avis", async () => {
    vi.mocked(getStudyView).mockResolvedValue(study(new Date("2026-04-01T00:00:00Z")) as never);
    await renderPage();
    expect(screen.getByText("Étude archivée : lecture seule.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fichier à importer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retirer" })).not.toBeInTheDocument();
  });

  it("affiche un état vide sans import", async () => {
    vi.mocked(listImports).mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("Aucun import pour cette étude.")).toBeInTheDocument();
  });

  it("signale l'indisponibilité du moteur au lieu de l'assistant", async () => {
    vi.mocked(engineClient.dictionary).mockRejectedValue(new Error("down"));
    await renderPage();
    expect(screen.getByText("Le moteur d'analyse est indisponible.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fichier à importer")).not.toBeInTheDocument();
  });
});
