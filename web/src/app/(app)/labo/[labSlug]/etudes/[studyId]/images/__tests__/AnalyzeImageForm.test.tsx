import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { AnalyzeImageForm } from "../AnalyzeImageForm";

const fetchMock = vi.fn();
const file = () => new File(["x"], "photo.tif", { type: "image/tiff" });
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("AnalyzeImageForm", () => {
  it("champs étiquetés, accept et aide de l'échelle", () => {
    render(<AnalyzeImageForm labSlug="labo" studyId="s1" />);
    expect(screen.getByLabelText("Image de microscopie")).toHaveAttribute(
      "accept",
      ".png,.jpg,.jpeg,.tif,.tiff",
    );
    expect(screen.getByLabelText("Échelle (µm par pixel)")).toBeInTheDocument();
    expect(screen.getByText(/Laissez vide pour un TIFF de MEB Hitachi/)).toBeInTheDocument();
  });

  it("envoie file et scale_um_per_px puis ouvre l'analyse", async () => {
    fetchMock.mockReturnValueOnce(json({ id: "abc" }));
    const user = userEvent.setup();
    render(<AnalyzeImageForm labSlug="labo" studyId="s1" />);
    await user.upload(screen.getByLabelText("Image de microscopie"), file());
    await user.type(screen.getByLabelText("Échelle (µm par pixel)"), "0,5");
    await user.click(screen.getByRole("button", { name: "Analyser l'image" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/labo/labo/etudes/s1/images/abc"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/labo/labo/etudes/s1/images/analyser");
    const fd = (init as RequestInit).body as FormData;
    expect((fd.get("file") as File).name).toBe("photo.tif");
    expect(fd.get("scale_um_per_px")).toBe("0,5");
  });

  it("erreur du serveur dans l'alerte, saisie conservée, pas de navigation", async () => {
    fetchMock.mockReturnValueOnce(json({ error: "Image illisible ou tronquée." }, 422));
    const user = userEvent.setup();
    render(<AnalyzeImageForm labSlug="labo" studyId="s1" />);
    await user.upload(screen.getByLabelText("Image de microscopie"), file());
    await user.type(screen.getByLabelText("Échelle (µm par pixel)"), "2");
    await user.click(screen.getByRole("button", { name: "Analyser l'image" }));
    expect(await screen.findByText("Image illisible ou tronquée.")).toBeInTheDocument();
    expect(screen.getByLabelText("Échelle (µm par pixel)")).toHaveValue("2");
    expect(push).not.toHaveBeenCalled();
  });

  it("sans fichier : message, aucun envoi", async () => {
    const user = userEvent.setup();
    render(<AnalyzeImageForm labSlug="labo" studyId="s1" />);
    await user.click(screen.getByRole("button", { name: "Analyser l'image" }));
    expect(screen.getByText("Choisissez l'image à analyser.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("« Analyse en cours… » désactivé pendant l'envoi", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    render(<AnalyzeImageForm labSlug="labo" studyId="s1" />);
    await user.upload(screen.getByLabelText("Image de microscopie"), file());
    await user.click(screen.getByRole("button", { name: "Analyser l'image" }));
    expect(await screen.findByRole("button", { name: "Analyse en cours…" })).toBeDisabled();
  });
});
