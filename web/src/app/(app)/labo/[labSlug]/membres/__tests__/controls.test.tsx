import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  inviteMemberAction: vi.fn(async () => ({
    ok: true,
    link: "http://localhost:3000/invitation/jeton-de-test",
  })),
  changeRoleAction: vi.fn(async () => ({})),
  removeMemberAction: vi.fn(async () => ({ error: "Le laboratoire doit garder au moins un responsable." })),
  revokeInvitationAction: vi.fn(async () => ({})),
}));

import { InviteForm, RemoveMemberButton } from "../controls";

describe("formulaire d'invitation", () => {
  it("montre le lien complet une fois l'invitation créée, avec un bouton de copie", async () => {
    render(<InviteForm labSlug="labo" />);
    await userEvent.type(screen.getByLabelText("Adresse e-mail"), "x@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Créer l'invitation" }));
    const link = await screen.findByLabelText("Lien d'invitation");
    expect(link).toHaveValue("http://localhost:3000/invitation/jeton-de-test");
    expect(screen.getByRole("button", { name: "Copier le lien" })).toBeInTheDocument();
  });
});

describe("retrait d'un membre", () => {
  it("affiche le refus du serveur dans le dialogue", async () => {
    render(<RemoveMemberButton labSlug="labo" membershipId="m1" memberName="Alice" />);
    await userEvent.click(screen.getByRole("button", { name: "Retirer" }));
    // Le déclencheur est masqué par le dialogue : seul le bouton de confirmation reste accessible.
    await userEvent.click(await screen.findByRole("button", { name: "Retirer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le laboratoire doit garder au moins un responsable.",
    );
  });
});
