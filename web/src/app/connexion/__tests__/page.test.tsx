import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  login: vi.fn(async () => ({ error: "Identifiants invalides." })),
}));

import { LoginForm } from "../LoginForm";

describe("LoginForm", () => {
  it("affiche les champs en français", () => {
    render(<LoginForm callbackUrl="/" />);
    expect(screen.getByLabelText("Adresse e-mail")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeInTheDocument();
  });

  it("affiche l'erreur générique, jamais « utilisateur inconnu »", async () => {
    render(<LoginForm callbackUrl="/" />);
    await userEvent.type(screen.getByLabelText("Adresse e-mail"), "x@example.org");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "nimportequoi");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Identifiants invalides.");
    expect(alert.textContent).not.toMatch(/inconnu/i);
  });
});

describe("page Connexion : avis après création de compte", () => {
  it("affiche « Compte créé. Connectez-vous. » avec le drapeau, sinon rien", async () => {
    const { default: ConnexionPage } = await import("../page");
    render(await ConnexionPage({ searchParams: Promise.resolve({ compte: "cree" }) }));
    expect(screen.getByText("Compte créé. Connectez-vous.")).toBeInTheDocument();
    cleanup();
    render(await ConnexionPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText("Compte créé. Connectez-vous.")).not.toBeInTheDocument();
  });
});
