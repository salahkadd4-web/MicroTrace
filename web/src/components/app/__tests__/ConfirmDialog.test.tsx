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

  it("reste ouvert avec le motif et l'erreur quand la confirmation échoue", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => "Refus du serveur.");
    render(
      <ConfirmDialog
        title="Archiver l'étude"
        description="Lecture seule."
        requireReason
        onConfirm={onConfirm}
        trigger={<button>Ouvrir</button>}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    await user.type(screen.getByLabelText("Motif"), "Terminée");
    await user.click(screen.getByRole("button", { name: "Confirmer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refus du serveur.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Motif")).toHaveValue("Terminée");
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

  it("confirme en variante par défaut, ou destructive à la demande", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <ConfirmDialog title="T" description="D" onConfirm={vi.fn()} trigger={<button>Ouvrir</button>} />,
    );
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    expect(screen.getByRole("button", { name: "Confirmer" })).toHaveAttribute("data-variant", "default");
    unmount();
    render(
      <ConfirmDialog
        title="T"
        description="D"
        confirmVariant="destructive"
        onConfirm={vi.fn()}
        trigger={<button>Ouvrir</button>}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    expect(screen.getByRole("button", { name: "Confirmer" })).toHaveAttribute("data-variant", "destructive");
  });
});
