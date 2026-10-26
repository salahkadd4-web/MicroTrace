import { render, screen } from "@testing-library/react";
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
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/projects", () => ({
  getProject: vi.fn(async (_ctx: unknown, id: string) =>
    id === "p1"
      ? {
          id: "p1",
          title: "Projet un",
          description: "Description du projet",
          createdAt: new Date("2026-03-01T10:00:00Z"),
          studies: [
            {
              id: "s1",
              title: "Étude Leslie",
              nature: "published",
              archivedAt: new Date("2026-04-01T10:00:00Z"),
              createdAt: new Date("2026-03-02T10:00:00Z"),
            },
          ],
        }
      : null,
  ),
}));
vi.mock("../actions", () => ({
  createStudyAction: vi.fn(async () => ({
    error: "Une étude publiée doit indiquer un DOI.",
  })),
}));

import ProjetPage from "../page";

const params = (projectId: string) => ({ params: Promise.resolve({ labSlug: "labo", projectId }) });

describe("page Projet", () => {
  it("a un seul h1 et liste les études avec leur statut", async () => {
    render(await ProjetPage(params("p1")));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Étude Leslie" })).toHaveAttribute(
      "href",
      "/labo/labo/etudes/s1/parametres",
    );
    expect(screen.getByText("Archivée")).toBeInTheDocument();
  });

  it("renvoie 404 pour un projet inconnu", async () => {
    await expect(ProjetPage(params("zzz"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("n'affiche DOI et licence qu'avec la nature « publiée »", async () => {
    const user = userEvent.setup();
    render(await ProjetPage(params("p1")));
    expect(screen.queryByLabelText("DOI de référence")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Licence de référence")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Nature des données"));
    await user.click(await screen.findByRole("option", { name: "Laboratoire" }));
    expect(screen.queryByLabelText("DOI de référence")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Nature des données"));
    await user.click(await screen.findByRole("option", { name: "Publiée" }));
    expect(screen.getByLabelText("DOI de référence")).toBeInTheDocument();
    expect(screen.getByLabelText("Licence de référence")).toBeInTheDocument();
  });

  it("conserve titre, nature « publiée » et DOI après une erreur", async () => {
    const user = userEvent.setup();
    render(await ProjetPage(params("p1")));
    await user.type(screen.getByLabelText("Titre"), "Nouvelle étude");
    await user.click(screen.getByLabelText("Nature des données"));
    await user.click(await screen.findByRole("option", { name: "Publiée" }));
    await user.type(screen.getByLabelText("DOI de référence"), "10.1000/xyz");
    await user.click(screen.getByRole("button", { name: "Créer l'étude" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Titre")).toHaveValue("Nouvelle étude");
    expect(screen.getByLabelText("Nature des données")).toHaveTextContent("Publiée");
    expect(screen.getByLabelText("DOI de référence")).toHaveValue("10.1000/xyz");
  });

  it("affiche l'erreur du moteur dans role=alert", async () => {
    const user = userEvent.setup();
    render(await ProjetPage(params("p1")));
    await user.type(screen.getByLabelText("Titre"), "Nouvelle étude");
    await user.click(screen.getByLabelText("Nature des données"));
    await user.click(await screen.findByRole("option", { name: "Laboratoire" }));
    await user.click(screen.getByRole("button", { name: "Créer l'étude" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Une étude publiée doit indiquer un DOI.",
    );
  });
});
