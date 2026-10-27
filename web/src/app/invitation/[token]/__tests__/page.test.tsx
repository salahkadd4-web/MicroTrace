import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getOptionalUser: vi.fn(async () => null) }));
vi.mock("@/server/invitations", () => ({ previewInvitation: vi.fn() }));
vi.mock("../../../(app)/actions", () => ({ logout: vi.fn() }));
vi.mock("../actions", () => ({ acceptInvitationAction: vi.fn(async () => ({})) }));

import { previewInvitation } from "@/server/invitations";
import InvitationPage, { metadata } from "../page";

const props = { params: Promise.resolve({ token: "jeton-secret-de-test" }) };

function preview(p: Awaited<ReturnType<typeof previewInvitation>>) {
  vi.mocked(previewInvitation).mockResolvedValue(p);
}

beforeEach(() => vi.mocked(previewInvitation).mockReset());

describe("page /invitation/[token]", () => {
  it("n'envoie pas le jeton en en-tête Referer et n'est pas indexée", () => {
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("invitation invalide : message dédié, un seul h1, aucun jeton dans la page", async () => {
    preview({ state: "invalid" });
    const { container } = render(await InvitationPage(props));
    expect(screen.getByText("Invitation invalide ou expirée.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.innerHTML).not.toContain("jeton-secret-de-test");
  });

  it("création de compte : e-mail en lecture seule, nom et mot de passe", async () => {
    preview({ state: "signup", labName: "Labo Alpha", email: "nouvelle@example.org", role: "researcher" });
    const { container } = render(await InvitationPage(props));
    const email = screen.getByLabelText("Adresse e-mail");
    expect(email).toHaveValue("nouvelle@example.org");
    expect(email).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Nom")).toBeInTheDocument();
    expect(screen.getByLabelText(/Mot de passe/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer mon compte" })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("jeton-secret-de-test");
  });

  it("compte existant, non connecté : lien vers la connexion qui revient à l'invitation", async () => {
    preview({ state: "login-required", labName: "Labo Alpha", role: "viewer" });
    render(await InvitationPage(props));
    expect(
      screen.getByText(
        "Un compte existe déjà pour cette adresse : connectez-vous puis rouvrez le lien.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute(
      "href",
      "/connexion?callbackUrl=%2Finvitation%2Fjeton-secret-de-test",
    );
  });

  it("connecté avec la bonne adresse : bouton « Rejoindre le laboratoire »", async () => {
    preview({ state: "join", labName: "Labo Alpha", email: "a@example.org", role: "viewer" });
    render(await InvitationPage(props));
    expect(screen.getByRole("button", { name: "Rejoindre le laboratoire" })).toBeInTheDocument();
  });

  it("connecté avec une autre adresse", async () => {
    preview({ state: "wrong-email", labName: "Labo Alpha" });
    render(await InvitationPage(props));
    expect(
      screen.getByText("Cette invitation est destinée à une autre adresse e-mail."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("déjà membre", async () => {
    preview({ state: "already-member", labName: "Labo Alpha", labSlug: "labo-alpha" });
    render(await InvitationPage(props));
    expect(screen.getByText("Vous êtes déjà membre de ce laboratoire.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir le laboratoire" })).toHaveAttribute(
      "href",
      "/labo/labo-alpha/projets",
    );
  });
});
