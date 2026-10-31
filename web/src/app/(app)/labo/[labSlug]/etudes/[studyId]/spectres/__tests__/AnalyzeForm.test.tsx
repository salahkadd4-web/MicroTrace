import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { AnalyzeForm } from "../AnalyzeForm";

const fetchMock = vi.fn();
const file = () => new File(["400,1\n500,2\n"], "spectre.csv", { type: "text/csv" });
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("AnalyzeForm", () => {
  it("laser visible en Raman seulement, ordonnée en FTIR seulement", async () => {
    const user = userEvent.setup();
    render(<AnalyzeForm labSlug="labo" studyId="s1" />);
    expect(screen.getByLabelText("Fichier du spectre")).toBeInTheDocument();
    expect(screen.getByLabelText("Longueur d'onde du laser (nm)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ordonnée")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "FTIR (ATR)" }));
    expect(screen.queryByLabelText("Longueur d'onde du laser (nm)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ordonnée")).toBeInTheDocument();
  });

  it("envoie file, technique, x_unit, y_unit, laser_nm puis ouvre l'analyse", async () => {
    fetchMock.mockReturnValueOnce(json({ id: "abc" }));
    const user = userEvent.setup();
    render(<AnalyzeForm labSlug="labo" studyId="s1" />);
    await user.upload(screen.getByLabelText("Fichier du spectre"), file());
    await user.type(screen.getByLabelText("Longueur d'onde du laser (nm)"), "785");
    await user.click(screen.getByRole("button", { name: "Analyser le spectre" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/labo/labo/etudes/s1/spectres/abc"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/labo/labo/etudes/s1/spectres/analyser");
    const fd = (init as RequestInit).body as FormData;
    expect((fd.get("file") as File).name).toBe("spectre.csv");
    expect(fd.get("technique")).toBe("raman");
    expect(fd.get("x_unit")).toBe("cm-1");
    expect(fd.get("y_unit")).toBe("intensity");
    expect(fd.get("laser_nm")).toBe("785");
  });

  it("FTIR : ordonnée choisie, pas de laser", async () => {
    fetchMock.mockReturnValueOnce(json({ id: "abc" }));
    const user = userEvent.setup();
    render(<AnalyzeForm labSlug="labo" studyId="s1" />);
    await user.upload(screen.getByLabelText("Fichier du spectre"), file());
    await user.click(screen.getByRole("radio", { name: "FTIR (ATR)" }));
    await user.selectOptions(screen.getByLabelText("Ordonnée"), "transmittance_pct");
    await user.click(screen.getByRole("button", { name: "Analyser le spectre" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const fd = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(fd.get("technique")).toBe("ftir_atr");
    expect(fd.get("x_unit")).toBe("cm-1");
    expect(fd.get("y_unit")).toBe("transmittance_pct");
    expect(fd.get("laser_nm")).toBe("");
  });

  it("erreur du serveur dans FormError, choix conservés, pas de navigation", async () => {
    fetchMock.mockReturnValueOnce(json({ error: "Unité de l'axe inconnue." }, 422));
    const user = userEvent.setup();
    render(<AnalyzeForm labSlug="labo" studyId="s1" />);
    await user.upload(screen.getByLabelText("Fichier du spectre"), file());
    await user.type(screen.getByLabelText("Longueur d'onde du laser (nm)"), "532");
    await user.click(screen.getByRole("button", { name: "Analyser le spectre" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unité de l'axe inconnue.");
    expect(screen.getByLabelText("Longueur d'onde du laser (nm)")).toHaveValue("532");
    expect(screen.getByRole("radio", { name: "Raman" })).toBeChecked();
    expect(push).not.toHaveBeenCalled();
  });

  it("bouton désactivé pendant l'envoi", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((res) => (release = res)));
    const user = userEvent.setup();
    render(<AnalyzeForm labSlug="labo" studyId="s1" />);
    await user.upload(screen.getByLabelText("Fichier du spectre"), file());
    await user.type(screen.getByLabelText("Longueur d'onde du laser (nm)"), "785");
    await user.click(screen.getByRole("button", { name: "Analyser le spectre" }));
    expect(await screen.findByRole("button", { name: "Analyse en cours…" })).toBeDisabled();
    release(new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });
});
