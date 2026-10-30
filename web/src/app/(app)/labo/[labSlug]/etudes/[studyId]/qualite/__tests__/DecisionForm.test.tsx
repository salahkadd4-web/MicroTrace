import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const record = vi.fn<(...args: unknown[]) => Promise<{ ok?: true; error?: string }>>(async () => ({ ok: true }));
vi.mock("../actions", () => ({
  recordQualityDecisionAction: (...a: unknown[]) => record(...a),
}));

import { DecisionForm } from "../DecisionForm";

const KEY = "a".repeat(64);
const setup = () => render(<DecisionForm labSlug="labo" studyId="s1" signalKey={KEY} />);

describe("DecisionForm", () => {
  it("propose trois choix étiquetés", () => {
    setup();
    for (const name of ["Examiné — justifié", "À vérifier", "Erreur de saisie confirmée"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("la note est requise pour justifié et erreur de saisie, pas pour À vérifier", async () => {
    const user = userEvent.setup();
    setup();
    const note = screen.getByLabelText("Note");
    await user.click(screen.getByRole("radio", { name: "Examiné — justifié" }));
    expect(note).toBeRequired();
    expect(screen.getByText("Note requise pour cette décision.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "À vérifier" }));
    expect(note).not.toBeRequired();
    await user.click(screen.getByRole("radio", { name: "Erreur de saisie confirmée" }));
    expect(note).toBeRequired();
  });

  it("envoie studyId, signalKey, décision et note", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("radio", { name: "Examiné — justifié" }));
    await user.type(screen.getByLabelText("Note"), "Vérifié sur le cahier");
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => expect(record).toHaveBeenCalled());
    const fd = record.mock.calls.at(-1)![2] as FormData;
    expect(record.mock.calls.at(-1)![0]).toBe("labo");
    expect(fd.get("studyId")).toBe("s1");
    expect(fd.get("signalKey")).toBe(KEY);
    expect(fd.get("decision")).toBe("justified");
    expect(fd.get("note")).toBe("Vérifié sur le cahier");
  });

  it("erreur du serveur dans FormError, saisie conservée", async () => {
    record.mockResolvedValueOnce({ error: "Ce signal n'existe plus : rechargez la page." });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("radio", { name: "À vérifier" }));
    await user.type(screen.getByLabelText("Note"), "ma saisie");
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce signal n'existe plus");
    expect(screen.getByLabelText("Note")).toHaveValue("ma saisie");
    expect(screen.getByRole("radio", { name: "À vérifier" })).toBeChecked();
  });

  it("bouton désactivé pendant l'envoi", async () => {
    let release!: () => void;
    record.mockImplementationOnce(() => new Promise((res) => { release = () => res({ ok: true }); }));
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("radio", { name: "À vérifier" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    const pending = await screen.findByRole("button", { name: "Enregistrement…" });
    expect(pending).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistrer la décision" })).toBeEnabled());
  });
});
