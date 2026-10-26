import { describe, expect, it } from "vitest";
import { auditActionLabel, auditObjectName, diffChanges, entityTypeLabel } from "../audit-labels";
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
      { field: "LOD", before: "—", after: "0,5" },
      { field: "Unité", before: "—", after: "µg/mL" },
    ]);
  });
  it("gère l'absence de before ou after", () => {
    expect(diffChanges(null, { name: "M1" })).toEqual([
      { field: "Nom", before: "—", after: "M1" },
    ]);
    expect(diffChanges(null, null)).toEqual([]);
  });

  it("humanise énumérations, nombres, dates et identifiants", () => {
    const methodNames = new Map([["m1", "Py-GC/MS"]]);
    const changes = diffChanges(
      null,
      {
        nature: "published",
        blankCorrected: "unknown",
        technique: "py_gc_ms",
        kind: "procedural_blank",
        loq: 1234.5,
        archivedAt: "2026-03-02T10:00:00.000Z",
        methodId: "m1",
        studyId: "s1",
        ids: { methods: ["a"], limits: [] },
        methodsCreated: 2,
      },
      { methodNames },
    );
    const byField = Object.fromEntries(changes.map((c) => [c.field, c.after]));
    expect(byField["Nature des données"]).toBe("Publiée");
    expect(byField["Correction du blanc"]).toBe("Inconnu");
    expect(byField["Technique"]).toBe("Py-GC/MS");
    expect(byField["Type"]).toBe("Blanc procédural");
    expect(byField["LOQ"]).toMatch(/^1\s234,5$/u);
    expect(byField["Archivée le"]).toBe("02/03/2026 11:00");
    expect(byField["Méthode"]).toBe("Py-GC/MS");
    expect(byField["Méthodes créées"]).toBe("2");
    expect(Object.keys(byField)).not.toContain("Étude");
    expect(Object.keys(byField)).not.toContain("Identifiants");
    expect(changes.some((c) => c.after.includes("{") || c.after.includes("["))).toBe(false);
  });

  it("omet une méthode introuvable au lieu d'afficher son identifiant", () => {
    expect(diffChanges(null, { methodId: "zzz", polymer: "PE" })).toEqual([
      { field: "Polymère", before: "—", after: "PE" },
    ]);
  });

  it("donne le nom de l'objet quand il est connu", () => {
    const methodNames = new Map([["m1", "Py-GC/MS"]]);
    expect(auditObjectName({ entityType: "Method", before: null, after: { name: "M1" } })).toBe("M1");
    expect(auditObjectName({ entityType: "Study", before: null, after: { title: "Étude A" } })).toBe("Étude A");
    expect(
      auditObjectName({ entityType: "DetectionLimit", before: null, after: { polymer: "PE", methodId: "m1" } }, { methodNames }),
    ).toBe("PE (Py-GC/MS)");
    expect(auditObjectName({ entityType: "Study", before: null, after: { methodsCreated: 1 } })).toBeNull();
  });
});
