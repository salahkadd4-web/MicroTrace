import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  csvCell,
  parseDictionaryNames,
  reportFileName,
  slugTitle,
  toCsv,
} from "@/server/report-files";

describe("slugTitle", () => {
  it("passe en ASCII minuscule, sans accents, tirets réduits", () => {
    expect(slugTitle("Étude  Leslie — 2022 (sang)")).toBe("etude-leslie-2022-sang");
  });
  it("limite à 60 caractères sans tiret final", () => {
    const s = slugTitle("a".repeat(59) + " bbbb");
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
  it("retombe sur « etude »", () => {
    expect(slugTitle("日本語 !!")).toBe("etude");
    expect(slugTitle("")).toBe("etude");
  });
});

describe("noms de fichiers", () => {
  const d = new Date("2026-10-30T23:59:00Z");
  it("rapport et mesures", () => {
    expect(reportFileName("html", "Étude A", d)).toBe("rapport-etude-a-2026-10-30.html");
    expect(reportFileName("md", "Étude A", d)).toBe("rapport-etude-a-2026-10-30.md");
    expect(reportFileName("csv", "Étude A", d)).toBe("mesures-etude-a-2026-10-30.csv");
  });
  it("Content-Disposition avec filename et filename*", () => {
    expect(contentDisposition("a-b.csv")).toBe(
      `attachment; filename="a-b.csv"; filename*=UTF-8''a-b.csv`,
    );
  });
});

describe("csvCell", () => {
  it("null et undefined donnent une cellule vide", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("cite ; \" CR LF et double les guillemets", () => {
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a,b")).toBe("a,b");
  });
  it("neutralise les formules", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe(`"'\rx"`);
    expect(csvCell("=A;B")).toBe(`"'=A;B"`);
  });
  it("ne touche pas aux nombres", () => {
    expect(csvCell(-0.5)).toBe("-0.5");
    expect(csvCell("-0.5")).toBe("-0.5");
    expect(csvCell("+3")).toBe("+3");
    expect(csvCell("-1e-7")).toBe("-1e-7");
    expect(csvCell(0)).toBe("0");
    expect(csvCell("-")).toBe("'-");
    expect(csvCell("<LOD")).toBe("<LOD");
  });
});

describe("toCsv", () => {
  it("BOM, point-virgule, CRLF", () => {
    const out = toCsv(["a", "b"], [["x", 1], [null, "y;z"]]);
    expect(out).toBe('﻿a;b\r\nx;1\r\n;"y;z"\r\n');
  });
});

describe("parseDictionaryNames", () => {
  it("lit la colonne name, avec champs entre guillemets et sauts de ligne", () => {
    const csv = 'name,label_fr,type\r\nsample_id,"Id, x",text\r\nunit,"a\nb",enum\n';
    expect(parseDictionaryNames(csv)).toEqual(["sample_id", "unit"]);
  });
  it("refuse un dictionnaire sans colonne name", () => {
    expect(() => parseDictionaryNames("x,y\n1,2\n")).toThrow();
  });
});
