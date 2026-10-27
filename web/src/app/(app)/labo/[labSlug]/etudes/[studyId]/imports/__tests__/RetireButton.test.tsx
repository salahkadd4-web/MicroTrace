import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const retire = vi.fn<(...args: unknown[]) => Promise<{ ok?: true; error?: string }>>(async () => ({ ok: true }));
vi.mock("../actions", () => ({ retireImportAction: (...a: unknown[]) => retire(...a) }));

import { RetireButton } from "../RetireButton";

describe("RetireButton", () => {
  it("exige un motif puis appelle l'action", async () => {
    const user = userEvent.setup();
    render(<RetireButton labSlug="labo" importRunId="r1" fileName="a.csv" />);
    await user.click(screen.getByRole("button", { name: "Retirer" }));
    const confirm = screen.getByRole("button", { name: "Retirer l'import" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Motif"), "Mauvais fichier");
    await user.click(confirm);
    expect(retire).toHaveBeenCalledWith("labo", "r1", "Mauvais fichier");
  });

  it("reste ouvert avec l'erreur en cas d'échec", async () => {
    retire.mockResolvedValueOnce({ error: "Import déjà retiré." });
    const user = userEvent.setup();
    render(<RetireButton labSlug="labo" importRunId="r1" fileName="a.csv" />);
    await user.click(screen.getByRole("button", { name: "Retirer" }));
    await user.type(screen.getByLabelText("Motif"), "x");
    await user.click(screen.getByRole("button", { name: "Retirer l'import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Import déjà retiré.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
