import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({ requireLab: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/labo/labo/etudes/s1/rapport",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/studies", () => ({ getStudyView: vi.fn() }));
vi.mock("@/server/report-download", () => ({ getReportAvailability: vi.fn() }));

import { requireLab } from "@/server/lab-context";
import { getReportAvailability } from "@/server/report-download";
import { getStudyView } from "@/server/studies";
import StudyLayout from "../../layout";
import RapportPage from "../page";

const study = {
  id: "s1",
  title: "Étude Leslie",
  nature: "published" as const,
  archivedAt: null,
  project: { id: "p1", title: "Projet un" },
};

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1" });
  const page = await RapportPage({ params });
  render(await StudyLayout({ params, children: page }));
}

const href = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue({ role: "viewer" } as never);
  vi.mocked(getStudyView).mockResolvedValue(study as never);
  vi.mocked(getReportAvailability).mockResolvedValue({ hasMeasurements: true });
});

describe("page Rapport", () => {
  it("un seul h1, la mention prototype et le contenu du rapport", async () => {
    await renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByText(/Prototype de recherche, pas un dispositif médical/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 2, name: /Contenu du rapport/ })).toBeInTheDocument();
    expect(screen.getByText(/règle d'agrégation/i)).toBeInTheDocument();
  });

  it("propose les téléchargements du rapport, des mesures et du dictionnaire", async () => {
    await renderPage();
    const base = "/labo/labo/etudes/s1/rapport";
    expect(href(/Rapport HTML/)).toBe(`${base}/telecharger?format=html`);
    expect(href(/Rapport Markdown/)).toBe(`${base}/telecharger?format=md`);
    expect(href(/Mesures actives \(CSV\)/)).toBe(`${base}/telecharger?format=csv`);
    expect(href(/Dictionnaire \(CSV\)/)).toBe(`${base}/dictionnaire?format=csv`);
    expect(href(/Dictionnaire \(Markdown\)/)).toBe(`${base}/dictionnaire?format=md`);
  });

  it("sans mesure active : rapport et CSV désactivés avec l'explication, dictionnaire disponible", async () => {
    vi.mocked(getReportAvailability).mockResolvedValue({ hasMeasurements: false });
    await renderPage();
    expect(screen.getByText("Aucun import actif : rien à exporter.")).toBeInTheDocument();
    for (const name of [/Rapport HTML/, /Rapport Markdown/, /Mesures actives/]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(href(/Dictionnaire \(CSV\)/)).toContain("dictionnaire?format=csv");
  });
});
