import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SubmitButton } from "../SubmitButton";

describe("SubmitButton", () => {
  it("affiche le libellé d'attente et se désactive pendant l'envoi", async () => {
    const action = () => new Promise<void>(() => {});
    render(
      <form action={action}>
        <SubmitButton pendingLabel="Envoi…">Envoyer</SubmitButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Envoyer" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    const pending = await screen.findByRole("button", { name: "Envoi…" });
    expect(pending).toBeDisabled();
  });
});
