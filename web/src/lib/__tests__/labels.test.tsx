import { describe, expect, it } from "vitest";
import { auditActionLabel, diffChanges, entityTypeLabel } from "../audit-labels";
import { parseDecimal } from "../parse-decimal";
import { unitLabel } from "../units";

describe("unitLabel", () => {
  it("affiche µ pour ug", () => {
    expect(unitLabel("ug/mL")).toBe("µg/mL");
    expect(unitLabel("particles/L")).toBe("particles/L");
  });
});

describe("parseDecimal", () => {
  it("accepte la virgule française", () => {
    expect(parseDecimal("1,5")).toEqual({ ok: true, value: 1.5 });
    expect(parseDecimal(" 2.25 ")).toEqual({ ok: true, value: 2.25 });
    expect(parseDecimal("-0,5")).toEqual({ ok: true, value: -0.5 });
  });
  it("vide devient null", () => {
    expect(parseDecimal("")).toEqual({ ok: true, value: null });
    expect(parseDecimal("   ")).toEqual({ ok: true, value: null });
    expect(parseDecimal(null)).toEqual({ ok: true, value: null });
  });
  it("refuse ce qui n'est pas un nombre", () => {
    expect(parseDecimal("abc")).toEqual({ ok: false });
    expect(parseDecimal("1,2,3")).toEqual({ ok: false });
    expect(parseDecimal("Infinity")).toEqual({ ok: false });
  });
});

describe("audit-labels", () => {
  it("traduit les codes réels du journal", () => {
    expect(auditActionLabel("study.method.add")).toBe("Méthode ajoutée");
    expect(auditActionLabel("study.prefill.leslie3")).toBe(
      "Préremplissage Leslie 2022 (Tableau 3)",
    );
    expect(auditActionLabel("user.login")).toBe("Connexion");
  });
  it("laisse un code inconnu tel quel", () => {
    expect(auditActionLabel("autre.chose")).toBe("autre.chose");
  });
  it("nomme les objets", () => {
    expect(entityTypeLabel("DetectionLimit")).toBe("Limite de détection");
    expect(entityTypeLabel("Truc")).toBe("Truc");
  });
  it("liste les changements champ par champ, en texte brut", () => {
    const changes = diffChanges(
      { title: "Ancien", lod: null },
      { title: "<b>Nouveau</b>", lod: 0.5, unitCode: "ug/mL" },
    );
    expect(changes).toEqual([
      { field: "Titre", before: "Ancien", after: "<b>Nouveau</b>" },
      { field: "LOD", before: "—", after: "0.5" },
      { field: "Unité", before: "—", after: "µg/mL" },
    ]);
  });
  it("gère l'absence de before ou after", () => {
    expect(diffChanges(null, { name: "M1" })).toEqual([
      { field: "Nom", before: "—", after: "M1" },
    ]);
    expect(diffChanges(null, null)).toEqual([]);
  });
});
