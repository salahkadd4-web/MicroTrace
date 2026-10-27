import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { IssuesTable } from "../IssuesTable";
import { issue } from "./fixtures";

const issues = [
  issue({ code: "E_REQUIRED_MISSING", severity: "error", message: "Valeur obligatoire absente." }),
  issue({ code: "E_REQUIRED_MISSING", severity: "error", message: "Autre absence." }),
  issue({ code: "W_NO_LIMITS", severity: "warning", message: "Aucune limite." }),
  issue({ code: "I_UNMAPPED_COLUMN", severity: "info", message: "Colonne ignorée." }),
];

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("IssuesTable", () => {
  it("résume les compteurs et affiche toutes les lignes", () => {
    render(<IssuesTable issues={issues} />);
    expect(screen.getByText("2 erreurs, 1 avertissement, 1 information")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1 + 4);
    expect(screen.getByRole("columnheader", { name: "Gravité" })).toBeInTheDocument();
  });

  it("le filtre par gravité masque les autres lignes", async () => {
    const user = userEvent.setup();
    render(<IssuesTable issues={issues} />);
    await pick(user, "Gravité", "Avertissements");
    expect(screen.getByText("Aucune limite.")).toBeInTheDocument();
    expect(screen.queryByText("Autre absence.")).not.toBeInTheDocument();
    expect(screen.queryByText("Colonne ignorée.")).not.toBeInTheDocument();
  });

  it("filtre par code parmi les codes présents", async () => {
    const user = userEvent.setup();
    render(<IssuesTable issues={issues} />);
    await user.click(screen.getByRole("combobox", { name: "Code" }));
    expect(screen.getAllByRole("option")).toHaveLength(1 + 3);
    await user.click(screen.getByRole("option", { name: "I_UNMAPPED_COLUMN" }));
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText("Colonne ignorée.")).toBeInTheDocument();
  });

  it("plafonne l'affichage à 500 lignes avec un avis", () => {
    const many = Array.from({ length: 700 }, (_, i) =>
      issue({ code: "W_NO_LIMITS", severity: "warning", message: `Problème ${i}` }),
    );
    render(<IssuesTable issues={many} />);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 500);
    expect(screen.getByText("500 premiers problèmes affichés")).toBeInTheDocument();
    expect(screen.getByText("0 erreur, 700 avertissements, 0 information")).toBeInTheDocument();
  });

  it("affiche un état vide sans problème", () => {
    render(<IssuesTable issues={[]} />);
    expect(screen.getByText("Aucun problème signalé.")).toBeInTheDocument();
  });
});
