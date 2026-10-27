import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "../AppShell";

const labs = [
  { slug: "alpha", name: "Labo Alpha" },
  { slug: "beta", name: "Labo Beta" },
];

function shell(list: typeof labs) {
  render(
    <AppShell
      userName="Alice"
      signOutAction={async () => {}}
      lab={{ slug: "alpha", name: "Labo Alpha" }}
      labs={list}
    >
      contenu
    </AppShell>,
  );
}

describe("AppShell", () => {
  it("affiche le nom du laboratoire et la déconnexion, sans sélecteur avec un seul laboratoire", () => {
    shell([labs[0]]);
    expect(screen.getByText("Labo Alpha")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Laboratoires" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projets" })).toHaveAttribute(
      "href",
      "/labo/alpha/projets",
    );
  });

  it("le logo mène aux projets du laboratoire courant, à l'accueil sans laboratoire", () => {
    shell([labs[0]]);
    expect(screen.getByRole("link", { name: "MicroTrace Studio" })).toHaveAttribute(
      "href",
      "/labo/alpha/projets",
    );
    cleanup();
    render(
      <AppShell userName="Alice" signOutAction={async () => {}}>
        contenu
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "MicroTrace Studio" })).toHaveAttribute("href", "/");
  });

  it("propose un sélecteur de liens dès deux laboratoires, le courant en aria-current", () => {
    shell(labs);
    const nav = screen.getByRole("navigation", { name: "Laboratoires" });
    const alpha = within(nav).getByRole("link", { name: "Labo Alpha" });
    const beta = within(nav).getByRole("link", { name: "Labo Beta" });
    expect(alpha).toHaveAttribute("aria-current", "true");
    expect(alpha).toHaveAttribute("href", "/labo/alpha/projets");
    expect(beta).not.toHaveAttribute("aria-current");
    expect(beta).toHaveAttribute("href", "/labo/beta/projets");
  });

  it("sans laboratoire courant, affiche seulement le produit et l'utilisateur", () => {
    render(
      <AppShell userName="Alice" signOutAction={async () => {}}>
        contenu
      </AppShell>,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Projets" })).not.toBeInTheDocument();
  });

  it("« Membres » seulement pour un responsable, « Console » seulement pour la plateforme", () => {
    const { rerender } = render(
      <AppShell userName="A" signOutAction={async () => {}} lab={{ slug: "alpha", name: "Alpha" }}>
        x
      </AppShell>,
    );
    expect(screen.queryByRole("link", { name: "Membres" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Console" })).not.toBeInTheDocument();
    rerender(
      <AppShell
        userName="A"
        signOutAction={async () => {}}
        lab={{ slug: "alpha", name: "Alpha" }}
        canManageMembers
        isPlatformAdmin
      >
        x
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Membres" })).toHaveAttribute(
      "href",
      "/labo/alpha/membres",
    );
    expect(screen.getByRole("link", { name: "Console" })).toHaveAttribute("href", "/admin");
  });
});
