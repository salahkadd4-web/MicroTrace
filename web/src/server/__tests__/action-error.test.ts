import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionError } from "@/server/action-error";
import { EngineUnavailableError } from "@/server/engine/client";
import { DomainError } from "@/server/errors";

afterEach(() => vi.restoreAllMocks());

describe("actionError", () => {
  it("renvoie le message d'un refus métier", () => {
    expect(actionError(new DomainError("Le titre est obligatoire."))).toEqual({
      error: "Le titre est obligatoire.",
    });
  });

  it("renvoie le message du moteur indisponible", () => {
    expect(actionError(new EngineUnavailableError())).toEqual({
      error: "Le moteur d'analyse est indisponible.",
    });
  });

  it("masque toute autre erreur et la journalise côté serveur", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = actionError(new Error("connection refused 10.0.0.1:5432"));
    expect(result).toEqual({ error: "Une erreur inattendue est survenue." });
    expect(JSON.stringify(result)).not.toMatch(/10\.0\.0\.1/);
    expect(log).toHaveBeenCalled();
  });

  it("ne journalise ni le message ni l'objet d'erreur (nom et code seulement)", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = Object.assign(new Error("Feuille Patients_Dupont introuvable dans secret.xlsx"), {
      code: "E_TABLE",
    });
    actionError(e);
    const printed = JSON.stringify(log.mock.calls);
    expect(printed).not.toMatch(/Dupont|secret|Feuille/);
    expect(log.mock.calls[0]).not.toContain(e);
    expect(printed).toContain("Error");
    expect(printed).toContain("E_TABLE");
  });

  it("relance les redirections de Next.js", () => {
    let caught: unknown;
    try {
      redirect("/labo/labo-a/projets/p1");
    } catch (e) {
      caught = e;
    }
    expect(() => actionError(caught)).toThrow(caught as Error);
  });
});
