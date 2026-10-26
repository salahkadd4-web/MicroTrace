import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({
  requireDefaultLab: vi.fn(async () => ({
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
}));

import { listProjects } from "@/server/projects";
import ProjetsPage from "../page";

describe("page Projets", () => {
  it("a un seul h1 et liste titre, nombre d'études et date", async () => {
    render(await ProjetsPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const row = screen.getByRole("row", { name: /Microplastiques sanguins/ });
    expect(within(row).getByRole("link", { name: "Microplastiques sanguins" })).toHaveAttribute(
      "href",
      "/projets/p1",
    );
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByText("01/03/2026 11:00")).toBeInTheDocument();
  });

  it("affiche un état vide sans projet", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([]);
    render(await ProjetsPage());
    expect(screen.getByText("Aucun projet pour le moment.")).toBeInTheDocument();
  });

  it("affiche l'erreur d'action dans role=alert", async () => {
    render(await ProjetsPage());
    await userEvent.type(screen.getByLabelText("Titre"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Créer le projet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Le titre est obligatoire.");
  });
});
