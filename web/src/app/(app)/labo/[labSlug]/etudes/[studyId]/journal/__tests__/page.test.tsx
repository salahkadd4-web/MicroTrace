import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({
  requireLab: vi.fn(async () => ({
    userId: "u1",
    userName: "Alice",
    laboratoryId: "lab1",
    labSlug: "labo",
    labName: "Labo",
    role: "researcher",
  })),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/labo/labo/etudes/s1/journal",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/studies", () => ({
  getStudyView: vi.fn(async () => ({
    id: "s1",
    title: "Étude Leslie",
    nature: "laboratory",
    archivedAt: null,
    project: { id: "p1", title: "Projet un" },
    methods: [{ id: "m1", name: "Py-GC/MS" }],
  })),
}));
vi.mock("@/server/audit", () => ({ listAuditEvents: vi.fn() }));

import { listAuditEvents } from "@/server/audit";
import StudyLayout from "../../layout";
import JournalPage from "../page";

const event = {
  id: "e1",
  createdAt: new Date("2026-03-02T10:00:00Z"),
  actorName: "Alice Martin",
  action: "study.method.add",
  entityType: "Method",
  entityId: "m1",
  before: null,
  after: { name: "Py-GC/MS", technique: "py_gc_ms" },
};

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1" });
  const page = await JournalPage({ params });
  render(await StudyLayout({ params, children: page }));
}

describe("page Journal", () => {
  it("a un seul h1, traduit l'action et n'affiche pas le JSON brut", async () => {
    vi.mocked(listAuditEvents).mockResolvedValue([event] as never);
    await renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const row = screen.getByRole("row", { name: /Méthode ajoutée/ });
    expect(row).toHaveTextContent("Alice Martin");
    expect(row).toHaveTextContent("02/03/2026 11:00");
    expect(row.textContent).not.toContain("py_gc_ms");
    expect(row.textContent).not.toContain("{");
  });

  it("montre les changements champ par champ dans « Détails »", async () => {
    vi.mocked(listAuditEvents).mockResolvedValue([
      { ...event, after: { name: "<b>Py</b>", technique: "py_gc_ms" } },
    ] as never);
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Détails" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nom")).toBeInTheDocument();
    expect(within(dialog).getByText("<b>Py</b>")).toBeInTheDocument();
    expect(dialog.querySelector("b")).toBeNull();
  });

  it("montre le nom de l'objet dans la colonne Objet", async () => {
    vi.mocked(listAuditEvents).mockResolvedValue([event] as never);
    await renderPage();
    const cells = within(screen.getByRole("row", { name: /Méthode ajoutée/ })).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("Py-GC/MS");
  });

  it("affiche un état vide sans événement", async () => {
    vi.mocked(listAuditEvents).mockResolvedValue([]);
    await renderPage();
    expect(screen.getByText("Aucun événement enregistré.")).toBeInTheDocument();
  });
});
