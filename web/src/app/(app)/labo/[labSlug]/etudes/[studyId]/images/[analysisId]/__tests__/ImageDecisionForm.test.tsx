import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const record = vi.fn<(...args: unknown[]) => Promise<{ ok?: true; error?: string }>>(
  async () => ({ ok: true }),
);
vi.mock("../actions", () => ({
  recordImageDecisionAction: (...a: unknown[]) => record(...a),
}));

import { ImageDecisionForm, type PreviousCorrection } from "../ImageDecisionForm";

const PARTICLES = [
  { id: 1, shapeLabel: "Fibre" },
  { id: 2, shapeLabel: "Bille" },
  { id: 3, shapeLabel: "Fragment" },
];
const setup = (unreliable = false, previous: PreviousCorrection | null = null) =>
  render(
    <ImageDecisionForm
      labSlug="labo"
      studyId="s1"
      analysisId="a1"
      unreliable={unreliable}
      particles={PARTICLES}
      previous={previous}
    />,
  );

describe("ImageDecisionForm", () => {
  it("trois choix", () => {
    setup();
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual([
      "accepted",
      "corrected",
      "rejected",
    ]);
  });

  it("« Acceptée » absent pour une image non fiable", () => {
    setup(true);
    expect(screen.queryByRole("radio", { name: "Acceptée" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("« Corrigée » : une ligne par particule, défaut « Proposée : … », particules manquées", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByLabelText("Particules manquées (sans contour)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Corrigée" }));
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    const third = screen.getByRole("combobox", { name: "Forme retenue pour la particule 3" });
    expect(third).toHaveTextContent("Proposée : Fragment");
    await user.click(third);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Proposée : Fragment",
      "Fibre",
      "Fragment",
      "Bille",
      "Film",
      "Pas une particule",
    ]);
    expect(screen.getByLabelText("Particules manquées (sans contour)")).toHaveValue(0);
  });

  it("deuxième correction : le formulaire reprend exclusions, formes et manquées de la précédente", async () => {
    const user = userEvent.setup();
    setup(false, { excluded: [3], reshaped: [{ id: 2, shape: "fragment" }], missed: 2 });
    await user.click(screen.getByRole("radio", { name: "Corrigée" }));
    expect(screen.getByRole("combobox", { name: "Forme retenue pour la particule 1" })).toHaveTextContent("Proposée : Fibre");
    expect(screen.getByRole("combobox", { name: "Forme retenue pour la particule 2" })).toHaveTextContent("Fragment");
    expect(screen.getByRole("combobox", { name: "Forme retenue pour la particule 3" })).toHaveTextContent("Pas une particule");
    expect(screen.getByLabelText("Particules manquées (sans contour)")).toHaveValue(2);
    expect(screen.getByText(/reprend votre dernière correction/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    const fd = record.mock.calls.at(-1)![2] as FormData;
    expect(fd.get("particle-3")).toBe("excluded");
    expect(fd.get("particle-2")).toBe("fragment");
    expect(fd.get("missed")).toBe("2");
  });

  it("note obligatoire pour « Rejetée » seulement", async () => {
    const user = userEvent.setup();
    setup();
    const note = screen.getByLabelText("Note");
    await user.click(screen.getByRole("radio", { name: "Rejetée" }));
    expect(note).toBeRequired();
    expect(screen.getByText("Note requise pour cette décision.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Acceptée" }));
    expect(note).not.toBeRequired();
  });

  it("erreur du service dans l'alerte, saisie conservée ; bouton désactivé pendant l'envoi", async () => {
    record.mockResolvedValueOnce({ error: "Une acceptation ne porte pas de correction." });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("radio", { name: "Acceptée" }));
    await user.type(screen.getByLabelText("Note"), "ok");
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect(await screen.findByText(/Une acceptation ne porte pas/)).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("ok");
    record.mockImplementationOnce(() => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect(await screen.findByRole("button", { name: "Enregistrement…" })).toBeDisabled();
  });
});
