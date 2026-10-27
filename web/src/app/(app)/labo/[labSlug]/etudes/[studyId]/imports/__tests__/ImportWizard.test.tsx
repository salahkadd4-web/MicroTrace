import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIELDS, MAPPING, TABLE, issue } from "./fixtures";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const suggest = vi.fn();
const check = vi.fn();
const save = vi.fn();
vi.mock("../actions", () => ({
  suggestMappingAction: (...a: unknown[]) => suggest(...a),
  checkImportAction: (...a: unknown[]) => check(...a),
  saveImportAction: (...a: unknown[]) => save(...a),
}));

import { ImportWizard } from "../ImportWizard";

const result = (issues: ReturnType<typeof issue>[]) => ({
  data: {
    issues,
    counts: {
      error: issues.filter((i) => i.severity === "error").length,
      warning: issues.filter((i) => i.severity === "warning").length,
      info: issues.filter((i) => i.severity === "info").length,
    },
    n_rows: 12,
    sheet: null,
  },
});

const fetchMock = vi.fn();

function csv(size?: number) {
  const f = new File(["a,b"], "mesures.csv", { type: "text/csv" });
  if (size !== undefined) Object.defineProperty(f, "size", { value: size });
  return f;
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

type User = ReturnType<typeof userEvent.setup>;

async function upload(user: User, file = csv()) {
  await user.upload(screen.getByLabelText("Fichier à importer"), file);
  await user.click(screen.getByRole("button", { name: "Envoyer le fichier" }));
  await screen.findByText("mesures.csv");
}

async function toCheck(user: User) {
  await upload(user);
  await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Suivant" }));
  await user.click(screen.getByRole("button", { name: "Suivant" }));
}

async function runCheck(user: User) {
  await user.click(screen.getByRole("button", { name: /^(Lancer|Relancer) le contrôle$/ }));
  await screen.findByText(/\d+ erreur/);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(ok({ token: "tok", table: TABLE }));
  suggest.mockResolvedValue({ data: MAPPING });
  check.mockResolvedValue(result([]));
  save.mockResolvedValue({ data: { importRunId: "r1" } });
});

describe("ImportWizard", () => {
  it("affiche les quatre étapes", () => {
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    for (const label of ["1. Dépôt", "2. Correspondance", "3. Contrôle", "4. Enregistrement"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("1. Dépôt").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("refuse tout de suite un fichier de plus de 50 Mo, sans envoi", async () => {
    const user = userEvent.setup();
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    await user.upload(screen.getByLabelText("Fichier à importer"), csv(50 * 1024 * 1024 + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fichier trop volumineux (50 Mo maximum).");
    expect(screen.getByRole("button", { name: "Envoyer le fichier" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [413, "Fichier trop volumineux (50 Mo maximum)."],
    [422, "Fichier illisible."],
  ])("affiche l'erreur %i du dépôt dans une alerte", async (status, message) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status, json: async () => ({ error: message }) });
    const user = userEvent.setup();
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    await user.upload(screen.getByLabelText("Fichier à importer"), csv());
    await user.click(screen.getByRole("button", { name: "Envoyer le fichier" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("montre « Envoi en cours… » pendant le dépôt et l'aperçu ensuite", async () => {
    let release!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    const user = userEvent.setup();
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    await user.upload(screen.getByLabelText("Fichier à importer"), csv());
    await user.click(screen.getByRole("button", { name: "Envoyer le fichier" }));
    expect(screen.getByRole("button", { name: "Envoi en cours…" })).toBeDisabled();
    release(ok({ token: "tok", table: TABLE }));
    expect(await screen.findByText("mesures.csv")).toBeInTheDocument();
    expect(screen.getByText("PE")).toBeInTheDocument();
    expect(suggest).toHaveBeenCalledWith("labo", "s1", "tok", null);
  });

  it("le bouton d'enregistrement est désactivé quand le contrôle signale une erreur", async () => {
    check.mockResolvedValue(result([issue({ code: "E_REQUIRED_MISSING", severity: "error" })]));
    const user = userEvent.setup();
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    await toCheck(user);
    await runCheck(user);
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
    expect(check).toHaveBeenCalledWith("labo", "s1", { token: "tok", sheet: null, mapping: MAPPING });
  });

  it("exige la case d'acceptation quand il y a des avertissements", async () => {
    check.mockResolvedValue(result([issue({ code: "W_NO_LIMITS", severity: "warning" })]));
    const user = userEvent.setup();
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    await toCheck(user);
    await runCheck(user);
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    const saveButton = screen.getByRole("button", { name: "Enregistrer l'import" });
    expect(saveButton).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "J'ai lu les avertissements et je les accepte" }));
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);
    expect(save).toHaveBeenCalledWith("labo", "s1", {
      token: "tok",
      sheet: null,
      mapping: MAPPING,
      acceptWarnings: true,
    });
  });

  it("après succès : alerte de succès, assistant réinitialisé, liste rafraîchie, un seul envoi", async () => {
    let release!: (v: unknown) => void;
    save.mockReturnValue(new Promise((r) => (release = r)));
    const user = userEvent.setup();
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    await toCheck(user);
    await runCheck(user);
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    const saveButton = screen.getByRole("button", { name: "Enregistrer l'import" });
    await user.click(saveButton);
    expect(saveButton).toBeDisabled();
    await user.click(saveButton);
    expect(save).toHaveBeenCalledTimes(1);
    release({ data: { importRunId: "r1" } });
    expect(await screen.findByText("Import enregistré.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByLabelText("Fichier à importer")).toBeInTheDocument();
  });

  it("changer la correspondance invalide le contrôle jusqu'au nouveau contrôle", async () => {
    const user = userEvent.setup();
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    await toCheck(user);
    await runCheck(user);
    expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Précédent" }));
    await user.click(screen.getByRole("checkbox", { name: "Séparer les aliquotes (suffixe a/b)" }));
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
    await runCheck(user);
    expect(check).toHaveBeenLastCalledWith("labo", "s1", {
      token: "tok",
      sheet: null,
      mapping: { ...MAPPING, split_aliquot_suffix: true },
    });
    expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();
  });

  it("changer de feuille relance la suggestion sur le dépôt déjà envoyé", async () => {
    fetchMock.mockResolvedValue(ok({ token: "tok", table: { ...TABLE, sheet: "A", sheets: ["A", "B"] } }));
    const user = userEvent.setup();
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    await upload(user);
    await user.click(await screen.findByRole("combobox", { name: "Feuille" }));
    await user.click(await screen.findByRole("option", { name: "B" }));
    await waitFor(() => expect(suggest).toHaveBeenLastCalledWith("labo", "s1", "tok", "B"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un contrôle qui refuse des données personnelles efface le dépôt", async () => {
    check.mockResolvedValue(result([issue({ code: "E_PII_COLUMN", severity: "error" })]));
    const user = userEvent.setup();
    render(<ImportWizard labSlug="labo" studyId="s1" fields={FIELDS} />);
    await toCheck(user);
    await user.click(screen.getByRole("button", { name: "Lancer le contrôle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Import refusé : le fichier contient des données personnelles.",
    );
    expect(screen.getByLabelText("Fichier à importer")).toBeInTheDocument();
  });
});
