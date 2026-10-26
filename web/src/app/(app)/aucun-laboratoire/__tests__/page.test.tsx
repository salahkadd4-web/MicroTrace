import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", name: "Alice", email: "a@example.org" })),
}));
vi.mock("@/server/labs", () => ({ listMyLaboratories: vi.fn(async () => []) }));
vi.mock("../../actions", () => ({ logout: vi.fn() }));

import { listMyLaboratories } from "@/server/labs";
import Page from "../page";

describe("page Aucun laboratoire", () => {
  it("affiche le message, un seul h1 et la déconnexion", async () => {
    render(await Page());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Vous n'êtes membre d'aucun laboratoire.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument();
  });

  it("redirige vers / si l'utilisateur a un laboratoire", async () => {
    vi.mocked(listMyLaboratories).mockResolvedValueOnce([{ id: "l" } as never]);
    await expect(Page()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});
