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
vi.mock("@/server/training-consent", () => ({
  getTrainingConsent: vi.fn(async () => ({
    granted: false, grantedAt: null, grantedBy: null, version: null, history: [],
  })),
}));
vi.mock("../actions", () => ({
  setTrainingConsentAction: vi.fn(async () => ({})),
  inviteMemberAction: vi.fn(async () => ({ ok: true, link: "http://localhost:3000/invitation/abc" })),
  changeRoleAction: vi.fn(async () => ({})),
  removeMemberAction: vi.fn(async () => ({})),
  revokeInvitationAction: vi.fn(async () => ({})),
}));

import { TRAINING_CONSENT_VERSION } from "@/lib/training-consent";
import { requireLab } from "@/server/lab-context";
import { getTrainingConsent } from "@/server/training-consent";
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

describe("section Données et amélioration des modèles", () => {
  it("désactivé : libellé, badge, bouton d'activation, aucun lien d'export", async () => {
    render(await MembresPage(props));
    const section = screen.getByRole("region", { name: "Données et amélioration des modèles" });
    expect(section).toHaveTextContent(
      "Autoriser l'utilisation des données validées de ce laboratoire pour améliorer les modèles",
    );
    expect(within(section).getByText("Désactivé")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Activer le consentement" })).toBeInTheDocument();
    expect(within(section).queryByRole("link")).toBeNull();
  });

  it("activé : date et auteur, liens d'export, historique", async () => {
    vi.mocked(getTrainingConsent).mockResolvedValueOnce({
      granted: true,
      grantedAt: new Date("2026-10-02T10:00:00Z"),
      grantedBy: "Alice Martin",
      version: TRAINING_CONSENT_VERSION,
      history: [
        { id: "h1", at: new Date("2026-10-03T10:00:00Z"), action: "lab.training_export", by: "Alice Martin" },
        { id: "h3", at: new Date("2026-10-03T11:00:00Z"), action: "lab.training_export", by: "Alice Martin", kind: "image" },
        { id: "h2", at: new Date("2026-10-02T10:00:00Z"), action: "lab.training_consent.grant", by: "Alice Martin" },
      ],
    });
    render(await MembresPage(props));
    const section = screen.getByRole("region", { name: "Données et amélioration des modèles" });
    expect(within(section).getByText("Activé")).toBeInTheDocument();
    expect(section).toHaveTextContent("Depuis le 02/10/2026 12:00, par Alice Martin (texte c2)");
    expect(within(section).getByRole("button", { name: "Retirer le consentement" })).toBeInTheDocument();
    expect(
      within(section).getByRole("link", { name: "Exporter les données consenties (JSON)" }),
    ).toHaveAttribute("href", "/labo/labo/membres/export-entrainement?format=json");
    expect(
      within(section).getByRole("link", { name: "Exporter les données consenties (CSV)" }),
    ).toHaveAttribute("href", "/labo/labo/membres/export-entrainement?format=csv");
    expect(
      within(section).getByRole("link", { name: "Exporter les images consenties (JSON)" }),
    ).toHaveAttribute("href", "/labo/labo/membres/export-entrainement?format=json&type=images");
    expect(
      within(section).getByRole("link", { name: "Exporter les images consenties (CSV)" }),
    ).toHaveAttribute("href", "/labo/labo/membres/export-entrainement?format=csv&type=images");
    expect(section).toHaveTextContent("images analysées telles que réécrites");
    expect(section).not.toHaveTextContent("retirez puis accordez de nouveau");
    const history = within(section).getByRole("table", { name: "Historique" });
    expect(within(history).getByText("Export des données consenties")).toBeInTheDocument();
    expect(within(history).getByText("Export des images consenties")).toBeInTheDocument();
    expect(within(history).getByText("Consentement donné (amélioration des modèles)")).toBeInTheDocument();
  });

  it("consentement donné en c1 : demande de le retirer puis de l'accorder de nouveau", async () => {
    vi.mocked(getTrainingConsent).mockResolvedValueOnce({
      granted: true,
      grantedAt: new Date("2026-10-02T10:00:00Z"),
      grantedBy: "Alice Martin",
      version: "c1",
      history: [],
    });
    render(await MembresPage(props));
    const section = screen.getByRole("region", { name: "Données et amélioration des modèles" });
    expect(section).toHaveTextContent(
      "Le texte du consentement a changé : retirez puis accordez de nouveau le consentement avant d'exporter.",
    );
    expect(within(section).queryByRole("link")).toBeNull();
  });
});
