import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ setTrainingConsentAction: vi.fn(async () => ({})) }));

import { setTrainingConsentAction } from "../actions";
import { ConsentControls } from "../ConsentControls";

beforeEach(() => vi.mocked(setTrainingConsentAction).mockClear());

describe("ConsentControls", () => {
  it("activer demande une confirmation avant l'appel", async () => {
    render(<ConsentControls labSlug="labo" granted={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Activer le consentement" }));
    expect(setTrainingConsentAction).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Activer le consentement" }));
    expect(setTrainingConsentAction).toHaveBeenCalledWith("labo", true);
  });

  it("retirer demande une confirmation et montre le refus du serveur", async () => {
    vi.mocked(setTrainingConsentAction).mockResolvedValueOnce({ error: "Le consentement n'est pas donné." });
    render(<ConsentControls labSlug="labo" granted />);
    await userEvent.click(screen.getByRole("button", { name: "Retirer le consentement" }));
    await userEvent.click(await screen.findByRole("button", { name: "Retirer le consentement" }));
    expect(setTrainingConsentAction).toHaveBeenCalledWith("labo", false);
    expect(await screen.findByRole("alert")).toHaveTextContent("Le consentement n'est pas donné.");
  });
});
