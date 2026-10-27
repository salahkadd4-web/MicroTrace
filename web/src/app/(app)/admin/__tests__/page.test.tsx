import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/platform-action", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ id: "p1", name: "Plat", email: "p@example.org" })),
}));
vi.mock("@/server/platform", () => ({
  listLaboratories: vi.fn(async () => [
    {
      id: "l1",
      name: "Labo Alpha",
      slug: "labo-alpha",
      suspended: false,
      createdAt: new Date("2026-03-01T10:00:00Z"),
      members: 3,
      studies: 2,
      imports: 5,
      admins: 1,
    },
    {
      id: "l2",
      name: "Labo Beta",
      slug: "labo-beta",
      suspended: true,
      createdAt: new Date("2026-03-02T10:00:00Z"),
      members: 1,
      studies: 0,
      imports: 0,
      admins: 0,
    },
  ]),
}));
vi.mock("../actions", () => ({
  createLaboratoryAction: vi.fn(async () => ({})),
  reinviteFirstAdminAction: vi.fn(async () => ({})),
  setSuspendedAction: vi.fn(async () => ({})),
}));
vi.mock("../../actions", () => ({ logout: vi.fn() }));

import { requirePlatformAdmin } from "@/server/platform-action";
import AdminLayout from "../layout";
import AdminPage from "../page";

beforeEach(() => {
  vi.mocked(requirePlatformAdmin).mockResolvedValue({
    id: "p1",
    name: "Plat",
    email: "p@example.org",
  });
});

describe("console /admin", () => {
  it("liste les laboratoires avec leurs seuls compteurs, statut et actions", async () => {
    render(await AdminPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const alpha = screen.getByRole("row", { name: /Labo Alpha/ });
    expect(within(alpha).getByText("Actif")).toBeInTheDocument();
    expect(within(alpha).getByText("3")).toBeInTheDocument();
    expect(within(alpha).getByText("5")).toBeInTheDocument();
    expect(within(alpha).getByRole("button", { name: "Suspendre" })).toBeInTheDocument();
    const beta = screen.getByRole("row", { name: /Labo Beta/ });
    expect(within(beta).getByText("Suspendu")).toBeInTheDocument();
    expect(within(beta).getByRole("button", { name: "Réactiver" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Créer un laboratoire" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nom du laboratoire")).toBeInTheDocument();
    expect(screen.getByLabelText("Adresse e-mail du premier responsable")).toBeInTheDocument();
  });

  it("propose la nouvelle invitation du responsable seulement pour un laboratoire sans responsable", async () => {
    render(await AdminPage());
    expect(
      screen.getByRole("heading", { level: 2, name: "Nouvelle invitation du responsable" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sans responsable : Labo Beta\./)).toBeInTheDocument();
  });

  it("ne demande que des compteurs au service (aucun titre d'étude dans la page)", async () => {
    const { container } = render(await AdminPage());
    expect(container.textContent).not.toMatch(/Étude confidentielle|valeur/i);
  });

  it("répond 404 à un non-administrateur (page et disposition)", async () => {
    const notFound = Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    vi.mocked(requirePlatformAdmin).mockRejectedValue(notFound);
    await expect(AdminPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(AdminLayout({ children: null })).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("la disposition affiche le lien Console", async () => {
    render(await AdminLayout({ children: <p>contenu</p> }));
    expect(screen.getByRole("link", { name: "Console" })).toHaveAttribute("href", "/admin");
  });
});
