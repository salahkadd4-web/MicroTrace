import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return { ...actual, engineClient: { report: vi.fn(), dictionary: vi.fn() } };
});

import { redirect } from "next/navigation";
import { GET as dictionaryGET, HEAD as dictionaryHEAD } from "../dictionnaire/route";
import { GET as reportGET, HEAD as reportHEAD } from "../telecharger/route";
import { prisma } from "@/server/db";
import {
  EngineError,
  EngineUnavailableError,
  engineClient,
  type ImportResult,
} from "@/server/engine/client";
import { NOTHING_TO_EXPORT } from "@/lib/engine-messages";
import { measurementRow } from "@/server/imports";
import { requireUser } from "@/server/session";
import { resetDb } from "../../../../../../../../../test/db-reset";
import { makeLab, makeMember } from "../../../../../../../../../test/labs";

const report = vi.mocked(engineClient.report);
const dictionary = vi.mocked(engineClient.dictionary);
const sessionUser = vi.mocked(requireUser);

type Rec = ImportResult["records"][number];
const RECORD: Rec = {
  sample_id: "S1",
  aliquot: "A",
  record_type: "sample",
  matrix: "whole_blood",
  matrix_detail: "EDTA",
  polymer: "PET",
  polymer_raw: "pet",
  method: "Py-GC/MS",
  technique: "py_gc_ms",
  reported_value: "-0.5",
  value: -0.5,
  unit: "ug/mL",
  canonical_value: -0.5,
  canonical_unit: "ug/mL",
  status: "quantified",
  lod: 0.1,
  loq: null,
  canonical_lod: 0.1,
  canonical_loq: null,
  identification_status: "confirmed",
  size_min_um: null,
  size_max_um: null,
  analysis_date: "2024-01-02",
  batch: "B1",
  lab: "=HYPERLINK(x)",
  comment: 'a;"b"',
  source_row: 2,
  source_column: "PET",
};
const NAMES = [
  "sample_id", "matrix", "polymer", "reported_value", "unit", "method", "aliquot", "record_type",
  "matrix_detail", "lod", "loq", "detection_status", "identification_status", "size_min_um",
  "size_max_um", "analysis_date", "batch", "lab", "comment",
];
const EXTRA = [
  "polymer_raw", "technique", "value", "canonical_value", "canonical_unit", "canonical_lod",
  "canonical_loq", "source_row", "source_column",
];
const DICT_CSV = `name,label_fr,type\r\n${NAMES.map((n) => `${n},"L, ${n}",text`).join("\r\n")}\r\n`;
const REPORT = { html: "<!doctype html><p>é '</p>", markdown: "# Rapport é\n" };

const frozen = {
  data_nature: "laboratory",
  methods: [{ name: "Py-GC/MS", technique: "py_gc_ms" }],
  limits: [],
  blank_corrected: "unknown",
};

let studyId: string;
let otherStudyId: string;
let emptyStudyId: string;
let labId: string;

async function setup(role: "viewer" | "researcher" = "viewer") {
  const lab = await makeLab("Labo A", "labo-a");
  labId = lab.id;
  const m = await makeMember(lab, role, "m@example.org");
  sessionUser.mockResolvedValue({ id: m.userId, name: "m", email: "m@example.org" });
  const project = await prisma.project.create({
    data: { title: "P", ownerId: m.userId, laboratoryId: lab.id },
  });
  const mk = (laboratoryId: string, projectId: string, title: string) =>
    prisma.study.create({
      data: { projectId, laboratoryId, title, nature: "laboratory" },
    });
  const study = await mk(lab.id, project.id, "Étude « Sang » n°1");
  studyId = study.id;
  emptyStudyId = (await mk(lab.id, project.id, "Vide")).id;

  const file = await prisma.dataFile.create({
    data: {
      studyId,
      originalName: "données été.csv",
      sha256: "s1",
      sizeBytes: 12,
      mimeType: "text/csv",
      storagePath: "p1",
      uploadedById: m.userId,
    },
  });
  const run = await prisma.importRun.create({
    data: {
      studyId,
      dataFileId: file.id,
      mapping: {},
      frozenContext: frozen,
      rulesVersion: "r1",
      engineVersion: "e",
      issues: [],
      createdById: m.userId,
    },
  });
  await prisma.measurement.createMany({
    data: [{ ...measurementRow(RECORD), studyId, importRunId: run.id }],
  });

  const labB = await makeLab("Labo B", "labo-b");
  const ownerB = await makeMember(labB, "researcher", "b@example.org");
  const projectB = await prisma.project.create({
    data: { title: "PB", ownerId: ownerB.userId, laboratoryId: labB.id },
  });
  otherStudyId = (await mk(labB.id, projectB.id, "Autre")).id;
}

const url = (route: string, q: string) => `http://localhost/x/${route}${q}`;
const callReport = (q: string, slug = "labo-a", id = studyId) =>
  reportGET(new Request(url("telecharger", q)), {
    params: Promise.resolve({ labSlug: slug, studyId: id }),
  });
const callDict = (q: string, slug = "labo-a", id = studyId) =>
  dictionaryGET(new Request(url("dictionnaire", q)), {
    params: Promise.resolve({ labSlug: slug, studyId: id }),
  });
const downloads = () => prisma.auditEvent.findMany({ where: { action: "report.download" } });

afterEach(() => vi.useRealTimers());

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T23:30:00Z") });
  await resetDb();
  report.mockReset();
  dictionary.mockReset();
  sessionUser.mockReset();
  report.mockResolvedValue(REPORT);
  dictionary.mockResolvedValue({ csv: DICT_CSV, markdown: "| a |\n| --- |\n" });
});

describe("GET rapport/telecharger", () => {
  it("HTML : octets du moteur, en-têtes, nom de fichier, audit", async () => {
    await setup("viewer");
    const res = await callReport("?format=html");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(REPORT.html);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    );
    const day = "2026-10-31"; // 23:30 UTC = 00:30 à Paris
    const name = `rapport-etude-sang-n-1-${day}.html`;
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${name}"; filename*=UTF-8''${name}`,
    );
    const events = await downloads();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      laboratoryId: labId,
      entityType: "Study",
      entityId: studyId,
      after: { format: "html" },
    });
  });

  it("HEAD : 405 Allow GET, sans appel au moteur ni audit", async () => {
    await setup();
    for (const head of [reportHEAD, dictionaryHEAD]) {
      const res = head();
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
    }
    expect(report).not.toHaveBeenCalled();
    expect(dictionary).not.toHaveBeenCalled();
    expect(await downloads()).toHaveLength(0);
  });

  it("laboratoire suspendu : 403 « Accès refusé. », sans moteur ni audit", async () => {
    await setup();
    await prisma.laboratory.update({ where: { id: labId }, data: { suspendedAt: new Date() } });
    for (const res of [await callReport("?format=html"), await callDict("?format=csv")]) {
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("Accès refusé.");
      expect(res.headers.get("content-disposition")).toBeNull();
    }
    expect(report).not.toHaveBeenCalled();
    expect(await downloads()).toHaveLength(0);
  });

  it("Markdown : octets du moteur, sans CSP", async () => {
    await setup();
    const res = await callReport("?format=md");
    expect(await res.text()).toBe(REPORT.markdown);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-disposition")).toContain(".md\"");
    expect((await downloads())[0].after).toEqual({ format: "md" });
  });

  it("la requête au moteur porte le contexte figé, le drapeau et l'import", async () => {
    await setup();
    await callReport("?format=md");
    const req = report.mock.calls[0][0];
    expect(req.context).toEqual({ ...frozen, reference_doi: null, reference_license: null });
    expect(req.context_changed).toBe(true); // le contexte actuel de l'étude diffère du figé
    expect(req.study).toEqual({ title: "Étude « Sang » n°1" });
    expect(req.imports[0]).toMatchObject({
      file: { name: "données été.csv", sha256: "s1", size: 12, sheet: null },
      rules_version: "r1",
      issues: [],
    });
    expect(req.records).toHaveLength(1);
    expect(req.qc_records).toEqual([]);
    expect(typeof req.generated_at).toBe("string");
  });

  it("CSV : BOM, « ; », CRLF, en-têtes du dictionnaire + import, valeurs telles quelles", async () => {
    await setup();
    const res = await callReport("?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain('filename="mesures-etude-sang-n-1-');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1);
    const [head, line, tail] = text.split("\r\n");
    expect(tail).toBe("");
    expect(head).toBe([...NAMES, ...EXTRA, "data_nature", "import"].join(";"));
    expect(line.split(";").length).toBeGreaterThan(NAMES.length); // comment est cité
    expect(line).toBe(
      [
        "S1", "whole_blood", "PET", "-0.5", "ug/mL", "Py-GC/MS", "A", "sample", "EDTA", "0.1", "",
        "quantified", "confirmed", "", "", "2024-01-02", "B1", "'=HYPERLINK(x)", '"a;""b"""',
        "pet", "py_gc_ms", "-0.5", "-0.5", "ug/mL", "0.1", "", "2", "PET",
        "laboratory", "données été.csv",
      ].join(";"),
    );
    expect((await downloads())[0].after).toEqual({ format: "csv" });
    expect(report).not.toHaveBeenCalled();
  });

  it("étude simulée : colonne data_nature, fichier préfixé SIMULE-, rapport SIMULÉ", async () => {
    await setup();
    await prisma.study.update({ where: { id: studyId }, data: { nature: "simulated" } });
    const csv = await callReport("?format=csv");
    expect(csv.headers.get("content-disposition")).toContain('filename="SIMULE-mesures-');
    const text = (await csv.text()).slice(1);
    const [head, line] = text.split(String.fromCharCode(13, 10));
    const cols = head.split(";");
    expect(cols.slice(-2)).toEqual(["data_nature", "import"]);
    expect(line.split(";").at(-2)).toBe("simulated");
    const md = await callReport("?format=md");
    expect(md.headers.get("content-disposition")).toContain('filename="SIMULE-rapport-');
    // Nature passée à « simulée » après l'import : le moteur reçoit la nature actuelle (SIMULÉ).
    expect(report.mock.calls[0][0].context.data_nature).toBe("simulated");
    expect(report.mock.calls[0][0].context_changed).toBe(true);
  });

  it("DOI, licence et correction du blanc actuels dans le rapport", async () => {
    await setup();
    await prisma.study.update({
      where: { id: studyId },
      data: { referenceDoi: "10.1234/neuf", referenceLicense: "CC0-1.0", blankCorrected: "yes" },
    });
    await callReport("?format=md");
    expect(report.mock.calls[0][0].context).toMatchObject({
      reference_doi: "10.1234/neuf",
      reference_license: "CC0-1.0",
      blank_corrected: "yes",
      methods: frozen.methods,
    });
  });

  it("format inconnu ou absent : 400", async () => {
    await setup();
    for (const q of ["?format=pdf", "", "?format="]) {
      expect((await callReport(q)).status).toBe(400);
    }
    expect(await downloads()).toHaveLength(0);
  });

  it("autre laboratoire ou identifiant inconnu : 404 sans détail", async () => {
    await setup();
    for (const [slug, id] of [
      ["labo-a", otherStudyId],
      ["labo-a", "inconnu"],
      ["labo-b", otherStudyId],
      ["nope", studyId],
    ]) {
      const res = await callReport("?format=html", slug, id);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-disposition")).toBeNull();
      expect(await res.text()).toBe("Introuvable.");
    }
    expect(report).not.toHaveBeenCalled();
    expect(await downloads()).toHaveLength(0);
  });

  it("sans session : 401", async () => {
    await setup();
    sessionUser.mockImplementation(async () => redirect("/connexion"));
    const res = await callReport("?format=html");
    expect(res.status).toBe(401);
    expect(report).not.toHaveBeenCalled();
  });

  it("étude archivée : téléchargeable", async () => {
    await setup();
    await prisma.study.update({ where: { id: studyId }, data: { archivedAt: new Date() } });
    expect((await callReport("?format=md")).status).toBe(200);
  });

  it("étude sans import actif : 409, aucun audit, moteur non appelé", async () => {
    await setup();
    for (const f of ["html", "md", "csv"]) {
      const res = await callReport(`?format=${f}`, "labo-a", emptyStudyId);
      expect(res.status).toBe(409);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe(NOTHING_TO_EXPORT);
    }
    expect(report).not.toHaveBeenCalled();
    expect(await downloads()).toHaveLength(0);
  });

  it("moteur indisponible : 503 texte, pas de pièce jointe, pas d'audit", async () => {
    await setup();
    report.mockRejectedValue(new EngineUnavailableError());
    const res = await callReport("?format=html");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Le moteur d'analyse est indisponible.");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    dictionary.mockRejectedValue(new EngineUnavailableError());
    expect((await callReport("?format=csv")).status).toBe(503);
    dictionary.mockRejectedValue(new EngineError(500, "x"));
    const csv = await callReport("?format=csv");
    expect(csv.status).toBe(502);
    expect(await csv.text()).toBe("Le moteur d'analyse n'a pas pu produire le fichier.");
    expect(await downloads()).toHaveLength(0);
  });

  it("navigation : les échecs ramènent à la page Rapport (303), sans audit", async () => {
    await setup();
    const base = `/labo/labo-a/etudes/${studyId}/rapport`;
    const navigate = (q: string, id = studyId) =>
      reportGET(
        new Request(url("telecharger", q), { headers: { "sec-fetch-mode": "navigate" } }),
        { params: Promise.resolve({ labSlug: "labo-a", studyId: id }) },
      );
    report.mockRejectedValue(new EngineUnavailableError());
    let res = await navigate("?format=html");
    expect([res.status, res.headers.get("location")]).toEqual([303, `${base}?erreur=moteur`]);
    expect(res.headers.get("content-disposition")).toBeNull();
    report.mockRejectedValue(new EngineError(422, "secret"));
    res = await navigate("?format=md");
    expect(res.headers.get("location")).toBe(`${base}?erreur=refus`);
    report.mockRejectedValue(new EngineError(413, "trop gros"));
    res = await navigate("?format=md");
    expect(res.headers.get("location")).toBe(`${base}?erreur=volume`);
    dictionary.mockRejectedValue(new EngineError(500, "x"));
    res = await navigate("?format=csv");
    expect(res.headers.get("location")).toBe(`${base}?erreur=refus`);
    res = await navigate("?format=html", emptyStudyId);
    expect(res.headers.get("location")).toBe(`/labo/labo-a/etudes/${emptyStudyId}/rapport?erreur=vide`);
    expect(await downloads()).toHaveLength(0);
    // Hors navigation (curl, fetch) : texte brut ; 413 a son propre message.
    expect((await callReport("?format=md")).status).toBe(502);
    report.mockRejectedValue(new EngineError(413, "trop gros"));
    const big = await callReport("?format=md");
    expect(await big.text()).toBe(
      "Étude trop volumineuse pour le calcul : retirez un import ou scindez l'étude.",
    );
  });

  it("navigation sans session : 303 vers /connexion?callbackUrl= la page Rapport ; autre laboratoire : 404", async () => {
    await setup();
    const nav = (slug: string, id: string) =>
      reportGET(
        new Request(url("telecharger", "?format=html"), { headers: { "sec-fetch-mode": "navigate" } }),
        { params: Promise.resolve({ labSlug: slug, studyId: id }) },
      );
    sessionUser.mockImplementation(async () => redirect("/connexion"));
    const res = await nav("labo-a", studyId);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `/connexion?callbackUrl=${encodeURIComponent(`/labo/labo-a/etudes/${studyId}/rapport`)}`,
    );
    sessionUser.mockReset();
    sessionUser.mockResolvedValue({ id: (await prisma.user.findFirstOrThrow()).id, name: "m", email: "m@example.org" });
    expect((await nav("labo-a", otherStudyId)).status).toBe(404);
  });

  it("moteur qui refuse : 502 sans le détail du moteur, pas d'audit", async () => {
    await setup();
    report.mockRejectedValue(new EngineError(422, "détail secret du moteur"));
    const res = await callReport("?format=md");
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toBe("Le moteur d'analyse n'a pas pu produire le rapport.");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await downloads()).toHaveLength(0);
  });
});

describe("GET rapport/dictionnaire", () => {
  it("CSV et Markdown du moteur, sans audit", async () => {
    await setup();
    const csv = await callDict("?format=csv");
    expect(csv.status).toBe(200);
    expect(Buffer.from(await csv.arrayBuffer()).toString("utf8")).toBe(`﻿${DICT_CSV}`);
    expect(csv.headers.get("content-disposition")).toContain('filename="dictionnaire-donnees.csv"');
    expect(csv.headers.get("x-content-type-options")).toBe("nosniff");
    expect(csv.headers.get("cache-control")).toBe("no-store");
    const md = await callDict("?format=md");
    expect(await md.text()).toBe("| a |\n| --- |\n");
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(md.headers.get("content-disposition")).toContain('filename="dictionnaire-donnees.md"');
    expect(await downloads()).toHaveLength(0);
  });

  it("disponible pour une étude sans mesure", async () => {
    await setup();
    expect((await callDict("?format=csv", "labo-a", emptyStudyId)).status).toBe(200);
  });

  it("format inconnu : 400 ; autre laboratoire : 404 ; moteur : 503/502", async () => {
    await setup();
    expect((await callDict("?format=html")).status).toBe(400);
    expect((await callDict("?format=csv", "labo-a", otherStudyId)).status).toBe(404);
    dictionary.mockRejectedValue(new EngineUnavailableError());
    expect((await callDict("?format=md")).status).toBe(503);
    dictionary.mockRejectedValue(new EngineError(500, "x"));
    const refused = await callDict("?format=md");
    expect(refused.status).toBe(502);
    expect(await refused.text()).toBe(
      "Le moteur d'analyse n'a pas pu produire le dictionnaire de données.",
    );
  });
});

describe("le TypeScript n'assemble ni HTML ni Markdown de rapport", () => {
  it("aucune balise HTML dans les sources de téléchargement", () => {
    const root = path.resolve(__dirname, "../../../../../../../..");
    for (const f of [
      "server/report-download.ts",
      "server/download-response.ts",
      "server/report-files.ts",
    ]) {
      const src = readFileSync(path.join(root, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/<\/?(html|body|head|table|tr|td|th|p|div|h[1-6]|ul|li|style|script|strong|blockquote)\b/i);
    }
  });
});
