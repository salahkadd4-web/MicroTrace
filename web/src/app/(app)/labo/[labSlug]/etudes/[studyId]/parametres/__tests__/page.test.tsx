import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  usePathname: () => "/labo/labo/etudes/s1/parametres",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const study = (archivedAt: Date | null, pseudonymDeclaredAt: Date | null = null) => ({
  id: "s1",
  title: "Étude Leslie",
  nature: "published" as const,
  referenceDoi: "10.1000/xyz",
  referenceLicense: "CC-BY-4.0",
  blankCorrected: "unknown" as const,
  pseudonymDeclaredAt,
  pseudonymDeclaredByName: pseudonymDeclaredAt ? "Alice Martin" : null,
  archivedAt,
  createdAt: new Date("2026-03-02T10:00:00Z"),
  project: { id: "p1", title: "Projet un" },
  methods: [{ id: "m1", name: "Py-GC/MS", technique: "py_gc_ms" }],
  limits: [
    { id: "l1", methodId: "m1", polymer: "PE", lod: 0.5, loq: 1.5, unitCode: "ug/mL", source: "Leslie 2022" },
  ],
  qcSummaries: [
    { id: "q1", polymer: "PE", kind: "procedural_blank", n: 3, mean: 0.2, sd: 0.05, unitCode: "ug/mL", source: "labo" },
  ],
});

vi.mock("@/server/studies", () => ({ getStudyView: vi.fn() }));
vi.mock("../actions", () => ({
  updateReferenceAction: vi.fn(async () => ({})),
  addMethodAction: vi.fn(async () => ({})),
  upsertLimitAction: vi.fn(async () => ({})),
  addQcAction: vi.fn(async () => ({})),
  prefillAction: vi.fn(async () => ({})),
  removeLimitAction: vi.fn(async () => ({})),
  removeQcAction: vi.fn(async () => ({})),
  declarePseudonymisationAction: vi.fn(async () => ({})),
  archiveStudyAction: vi.fn(async () => ({})),
}));

import { requireLab } from "@/server/lab-context";
import { getStudyView } from "@/server/studies";
import StudyLayout from "../../layout";
import ParametresPage from "../page";

async function renderPage() {
  const params = Promise.resolve({ labSlug: "labo", studyId: "s1" });
  const page = await ParametresPage({ params });
  render(await StudyLayout({ params, children: page }));
}

const asRole = (role: string) => ({
  userId: "u1",
  userName: "Alice",
  laboratoryId: "lab1",
  labSlug: "labo",
  labName: "Labo",
  role,
});

beforeEach(() => {
  vi.mocked(requireLab).mockResolvedValue(asRole("researcher") as never);
});

describe("page Paramètres", () => {
  it("un lecteur voit les données sans aucun formulaire ni bouton d'écriture", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("viewer") as never);
    vi.mocked(getStudyView).mockResolvedValue(study(null) as never);
    await renderPage();
    const row = screen.getByRole("row", { name: /Py-GC\/MS.*PE/ });
    expect(row).toHaveTextContent("µg/mL");
    expect(screen.getByText("Correction du blanc").nextElementSibling).toHaveTextContent("Inconnu");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      document.querySelectorAll("form, input:not([type=hidden]), select, textarea, button"),
    ).toHaveLength(0);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("un responsable de laboratoire voit les formulaires d'écriture", async () => {
    vi.mocked(requireLab).mockResolvedValue(asRole("lab_admin") as never);
    vi.mocked(getStudyView).mockResolvedValue(study(null) as never);
    await renderPage();
    expect(screen.getByRole("button", { name: "Ajouter la méthode" })).toBeEnabled();
  });

  it("a un seul h1 et marque l'onglet courant", async () => {
    vi.mocked(getStudyView).mockResolvedValue(study(null) as never);
    await renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Paramètres" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Journal" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Données publiées")).toBeInTheDocument();
  });

  it("affiche les limites avec l'unité en µ et les contrôles qualité", async () => {
    vi.mocked(getStudyView).mockResolvedValue(study(null) as never);
    await renderPage();
    const row = screen.getByRole("row", { name: /Py-GC\/MS.*PE/ });
    expect(row).toHaveTextContent("µg/mL");
    expect(row).toHaveTextContent("0,5");
    expect(screen.getByRole("button", { name: /Préremplir avec Leslie et al\. 2022 \(Tableau 3\)/ })).toBeEnabled();
  });

  it("un chercheur peut supprimer un contrôle qualité après confirmation destructive", async () => {
    vi.mocked(getStudyView).mockResolvedValue(study(null) as never);
    await renderPage();
    const row = screen.getByRole("row", { name: /PE.*labo/ });
    const button = within(row).getByRole("button", { name: "Supprimer" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Supprimer le contrôle qualité")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    const { removeQcAction } = await import("../actions");
    await waitFor(() => expect(removeQcAction).toHaveBeenCalledWith("labo", "q1"));
  });

  it("affiche la date et l'auteur de la pseudonymisation déclarée, sans case à cocher", async () => {
    vi.mocked(getStudyView).mockResolvedValue(
      study(null, new Date("2026-03-05T09:30:00Z")) as never,
    );
    await renderPage();
    expect(screen.getByText(/Alice Martin/)).toBeInTheDocument();
    expect(screen.getByText("05/03/2026 10:30")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("désactive tous les boutons et champs d'une étude archivée", async () => {
    vi.mocked(getStudyView).mockResolvedValue(
      study(new Date("2026-04-01T10:00:00Z")) as never,
    );
    await renderPage();
    expect(screen.getByText("Étude archivée : lecture seule.")).toBeInTheDocument();
    const controls = document.querySelectorAll(
      "input:not([type=hidden]), select, textarea, button",
    );
    expect(controls.length).toBeGreaterThan(5);
    for (const el of controls) expect(el).toBeDisabled();
  });
});
