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

vi.mock("@/server/projects", () => ({
  listProjects: vi.fn(async () => [
    {
      id: "p1",
      title: "Microplastiques sanguins",
      description: "",
      createdAt: new Date("2026-03-01T10:00:00Z"),
      _count: { studies: 2 },
    },
  ]),
}));
vi.mock("../actions", () => ({
  createProjectAction: vi.fn(async () => ({ error: "Le titre est obligatoire." })),
  createExampleStudyAction: vi.fn(async () => ({ error: "L'étude d'exemple a été créée, mais son import a échoué : x." })),
}));

import { requireLab } from "@/server/lab-context";
import { listProjects } from "@/server/projects";
import { createExampleStudyAction } from "../actions";
import ProjetsPage from "../page";

const props = { params: Promise.resolve({ labSlug: "labo" }) };

describe("page Projets", () => {
  it("un lecteur voit la liste sans formulaire ni bouton de création", async () => {
    vi.mocked(requireLab).mockResolvedValueOnce({ role: "viewer", labSlug: "labo" } as never);
    render(await ProjetsPage(props));
    expect(screen.getByRole("row", { name: /Microplastiques sanguins/ })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Titre")).not.toBeInTheDocument();
  });

  it("un lecteur sans projet voit un état vide neutre", async () => {
    vi.mocked(requireLab).mockResolvedValueOnce({ role: "viewer", labSlug: "labo" } as never);
    vi.mocked(listProjects).mockResolvedValueOnce([]);
    render(await ProjetsPage(props));
    expect(screen.getByText("Aucun projet pour le moment.")).toBeInTheDocument();
    expect(screen.queryByText(/ci-dessous/)).not.toBeInTheDocument();
  });

  it("a un seul h1 et liste titre, nombre d'études et date", async () => {
    render(await ProjetsPage(props));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const row = screen.getByRole("row", { name: /Microplastiques sanguins/ });
    expect(within(row).getByRole("link", { name: "Microplastiques sanguins" })).toHaveAttribute(
      "href",
      "/labo/labo/projets/p1",
    );
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByText("01/03/2026 11:00")).toBeInTheDocument();
  });

  it("affiche un état vide sans projet", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([]);
    render(await ProjetsPage(props));
    expect(screen.getByText("Aucun projet pour le moment.")).toBeInTheDocument();
  });

  it("affiche l'erreur d'action dans role=alert", async () => {
    render(await ProjetsPage(props));
    await userEvent.type(screen.getByLabelText("Titre"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Créer le projet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Le titre est obligatoire.");
  });

  it("un chercheur voit la section Études d'exemple avec ses deux boutons et la citation", async () => {
    render(await ProjetsPage(props));
    expect(screen.getByRole("heading", { level: 2, name: "Études d'exemple" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer l'étude d'exemple (fictive)" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Créer l'étude d'exemple réelle (Leslie et al. 2022)" }),
    ).toBeEnabled();
    expect(screen.getByText(/Environment International 163 \(2022\) 107199, licence CC\s+BY 4\.0/)).toBeInTheDocument();
  });

  it("un lecteur ne voit pas la section Études d'exemple", async () => {
    vi.mocked(requireLab).mockResolvedValueOnce({ role: "viewer", labSlug: "labo" } as never);
    render(await ProjetsPage(props));
    expect(screen.queryByText("Études d'exemple")).not.toBeInTheDocument();
  });

  it("le clic lance l'action avec le bon exemple et affiche l'erreur", async () => {
    render(await ProjetsPage(props));
    await userEvent.click(
      screen.getByRole("button", { name: "Créer l'étude d'exemple réelle (Leslie et al. 2022)" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("son import a échoué");
    expect(vi.mocked(createExampleStudyAction).mock.calls.at(-1)?.[2]).toBe("leslie2022");
  });
});
