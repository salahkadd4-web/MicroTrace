import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../ConfirmDialog";

describe("ConfirmDialog", () => {
  it("désactive la confirmation tant que le motif est vide", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Archiver l'étude"
        description="L'étude passera en lecture seule."
        requireReason
        onConfirm={onConfirm}
        trigger={<button>Ouvrir</button>}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    const confirm = screen.getByRole("button", { name: "Confirmer" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Motif"), "Étude terminée");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("Étude terminée");
  });

  it("n'exige pas de motif par défaut", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        title="Confirmer"
        description="Sûr ?"
        onConfirm={() => {}}
        trigger={<button>Ouvrir</button>}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    expect(screen.getByRole("button", { name: "Confirmer" })).toBeEnabled();
  });
});
