import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionState } from "@/lib/action-state";
import { ActionForm } from "../ActionForm";
import { FormField } from "../FormField";
import { SelectField } from "../SelectField";
import { Input } from "@/components/ui/input";

const OPTIONS = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
];

function setup(results: ActionState[]) {
  const action = vi.fn(async () => results.shift() ?? { ok: true as const });
  render(
    <ActionForm action={action} submitLabel="Envoyer" pendingLabel="Envoi…">
      {() => (
        <>
          <FormField id="nom" label="Nom">
            <Input id="nom" name="nom" />
          </FormField>
          <FormField id="choix" label="Choix">
            <SelectField id="choix" name="choix" options={OPTIONS} />
          </FormField>
        </>
      )}
    </ActionForm>,
  );
  return action;
}

describe("ActionForm", () => {
  it("conserve la saisie après une erreur et la vide après un succès", async () => {
    const user = userEvent.setup();
    const action = setup([{ error: "Refus du serveur." }, { ok: true }]);
    await user.type(screen.getByLabelText("Nom"), "abc");
    await user.click(screen.getByLabelText("Choix"));
    await user.click(await screen.findByRole("option", { name: "Option B" }));

    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refus du serveur.");
    expect(screen.getByLabelText("Nom")).toHaveValue("abc");
    expect(screen.getByLabelText("Choix")).toHaveTextContent("Option B");

    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(action).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByLabelText("Nom")).toHaveValue(""));
    expect(screen.getByLabelText("Choix")).toHaveTextContent("Choisir…");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("désactive le bouton pendant l'envoi", async () => {
    const user = userEvent.setup();
    const action = vi.fn(() => new Promise<ActionState>(() => {}));
    render(
      <ActionForm action={action} submitLabel="Envoyer" pendingLabel="Envoi…">
        {() => <Input aria-label="x" name="x" />}
      </ActionForm>,
    );
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByRole("button", { name: "Envoi…" })).toBeDisabled();
  });
});
