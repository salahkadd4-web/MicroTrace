import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const record = vi.fn<(...args: unknown[]) => Promise<{ ok?: true; error?: string }>>(async () => ({ ok: true }));
vi.mock("../actions", () => ({
  recordSpectralDecisionAction: (...a: unknown[]) => record(...a),
}));

import { DecisionForm } from "../DecisionForm";

const VOCAB = [
  { code: "PE", label: "Polyéthylène" },
  { code: "PP", label: "Polypropylène" },
  { code: "OTHER", label: "Autre polymère" },
  { code: "NOT_PLASTIC", label: "Non plastique" },
];
const setup = (notIdentified = false) =>
  render(
    <DecisionForm labSlug="labo" studyId="s1" analysisId="a1" notIdentified={notIdentified} vocabulary={VOCAB} />,
  );

describe("DecisionForm", () => {
  it("trois choix étiquetés", () => {
    setup();
    for (const name of ["Acceptée", "Corrigée", "Rejetée"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("« Acceptée » absent pour une abstention", () => {
    setup(true);
    expect(screen.queryByRole("radio", { name: "Acceptée" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("« Polymère retenu » visible pour Corrigée, avec le vocabulaire du moteur", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByLabelText("Polymère retenu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Corrigée" }));
    const select = screen.getByLabelText("Polymère retenu");
    const options = within(select).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["", "PE", "PP", "OTHER", "NOT_PLASTIC"]);
  });

  it("note obligatoire pour Rejetée et pour OTHER / NOT_PLASTIC", async () => {
    const user = userEvent.setup();
    setup();
    const note = screen.getByLabelText("Note");
    await user.click(screen.getByRole("radio", { name: "Rejetée" }));
    expect(note).toBeRequired();
    expect(screen.getByText("Note requise pour cette décision.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Acceptée" }));
    expect(note).not.toBeRequired();
    await user.click(screen.getByRole("radio", { name: "Corrigée" }));
    expect(note).not.toBeRequired();
    await user.selectOptions(screen.getByLabelText("Polymère retenu"), "PP");
    expect(note).not.toBeRequired();
    await user.selectOptions(screen.getByLabelText("Polymère retenu"), "OTHER");
    expect(note).toBeRequired();
    await user.selectOptions(screen.getByLabelText("Polymère retenu"), "NOT_PLASTIC");
    expect(note).toBeRequired();
  });

  it("envoie studyId, analysisId, decision, polymer et note", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("radio", { name: "Corrigée" }));
    await user.selectOptions(screen.getByLabelText("Polymère retenu"), "PP");
    await user.type(screen.getByLabelText("Note"), "Pic à 840");
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => expect(record).toHaveBeenCalled());
    const call = record.mock.calls.at(-1)!;
    const fd = call[2] as FormData;
    expect(call[0]).toBe("labo");
    expect(fd.get("studyId")).toBe("s1");
    expect(fd.get("analysisId")).toBe("a1");
    expect(fd.get("decision")).toBe("corrected");
    expect(fd.get("polymer")).toBe("PP");
    expect(fd.get("note")).toBe("Pic à 840");
  });

  it("erreur du serveur dans FormError, saisie conservée", async () => {
    record.mockResolvedValueOnce({ error: "Choisissez le polymère retenu." });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("radio", { name: "Rejetée" }));
    await user.type(screen.getByLabelText("Note"), "ma saisie");
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choisissez le polymère retenu.");
    expect(screen.getByLabelText("Note")).toHaveValue("ma saisie");
    expect(screen.getByRole("radio", { name: "Rejetée" })).toBeChecked();
  });

  it("bouton désactivé pendant l'envoi", async () => {
    let release!: () => void;
    record.mockImplementationOnce(() => new Promise((res) => { release = () => res({ ok: true }); }));
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("radio", { name: "Acceptée" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect(await screen.findByRole("button", { name: "Enregistrement…" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistrer la décision" })).toBeEnabled());
  });
});
