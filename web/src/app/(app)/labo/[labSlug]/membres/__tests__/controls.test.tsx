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

import { changeRoleAction } from "../actions";
import { InviteForm, RemoveMemberButton, RoleControl } from "../controls";

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

describe("changement de rôle", () => {
  async function choose(label: string) {
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: label }));
  }

  it("rétrograder un responsable demande une confirmation avant l'appel", async () => {
    vi.mocked(changeRoleAction).mockClear();
    render(<RoleControl labSlug="labo" membershipId="m1" role="lab_admin" memberName="Alice" />);
    await choose("Lecteur");
    expect(changeRoleAction).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Rétrograder" }));
    expect(changeRoleAction).toHaveBeenCalledWith("labo", "m1", "viewer");
  });

  it("annuler la confirmation n'appelle rien", async () => {
    vi.mocked(changeRoleAction).mockClear();
    render(<RoleControl labSlug="labo" membershipId="m1" role="lab_admin" memberName="Alice" />);
    await choose("Chercheur");
    await userEvent.click(await screen.findByRole("button", { name: "Annuler" }));
    expect(changeRoleAction).not.toHaveBeenCalled();
  });

  it("promouvoir un lecteur s'applique sans confirmation", async () => {
    vi.mocked(changeRoleAction).mockClear();
    render(<RoleControl labSlug="labo" membershipId="m2" role="viewer" memberName="Bob" />);
    await choose("Chercheur");
    expect(changeRoleAction).toHaveBeenCalledWith("labo", "m2", "researcher");
  });
});
