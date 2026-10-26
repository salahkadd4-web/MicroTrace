import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/lab-context", () => ({
  requireLab: vi.fn(async () => ({
    userId: "u1",
    laboratoryId: "lab1",
    labSlug: "labo",
    labName: "Labo",
    role: "lab_admin",
  })),
}));
vi.mock("@/server/members", () => ({
  listMembers: vi.fn(async () => [
    {
      id: "m1",
      userId: "u1",
      name: "Alice Martin",
      email: "alice@example.org",
      role: "lab_admin",
      createdAt: new Date("2026-03-01T10:00:00Z"),
    },
    {
      id: "m2",
      userId: "u2",
      name: "Bob Durand",
      email: "bob@example.org",
      role: "viewer",
      createdAt: new Date("2026-03-02T10:00:00Z"),
    },
  ]),
  listPendingInvitations: vi.fn(async () => [
    {
      id: "i1",
      email: "nouvelle@example.org",
      role: "researcher",
      expiresAt: new Date("2026-04-01T10:00:00Z"),
      createdAt: new Date("2026-03-25T10:00:00Z"),
    },
  ]),
}));
vi.mock("../actions", () => ({
  inviteMemberAction: vi.fn(async () => ({ ok: true, link: "http://localhost:3000/invitation/abc" })),
  changeRoleAction: vi.fn(async () => ({})),
  removeMemberAction: vi.fn(async () => ({})),
  revokeInvitationAction: vi.fn(async () => ({})),
}));

import { requireLab } from "@/server/lab-context";
import MembresPage from "../page";

const props = { params: Promise.resolve({ labSlug: "labo" }) };

describe("page Membres", () => {
  it.each(["viewer", "researcher"] as const)("un %s reçoit un 404", async (role) => {
    vi.mocked(requireLab).mockResolvedValueOnce({ role, labSlug: "labo" } as never);
    await expect(MembresPage(props)).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("un responsable voit les membres, les invitations en attente et le formulaire", async () => {
    render(await MembresPage(props));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("row", { name: /Alice Martin/ })).toBeInTheDocument();
    const bob = screen.getByRole("row", { name: /Bob Durand/ });
    expect(within(bob).getByRole("button", { name: "Retirer" })).toBeInTheDocument();
    expect(within(bob).getByLabelText("Rôle de Bob Durand")).toBeInTheDocument();
    const invitation = screen.getByRole("row", { name: /nouvelle@example.org/ });
    expect(within(invitation).getByText("Chercheur")).toBeInTheDocument();
    expect(within(invitation).getByRole("button", { name: "Révoquer" })).toBeInTheDocument();
    expect(screen.getByLabelText("Adresse e-mail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer l'invitation" })).toBeInTheDocument();
    for (const h of ["Membres du laboratoire", "Invitations en attente", "Inviter une personne"])
      expect(screen.getByRole("heading", { level: 2, name: h })).toBeInTheDocument();
  });
});
