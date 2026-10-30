import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return {
    ...actual,
    engineClient: { validateContext: vi.fn(async () => ({})), quality: vi.fn() },
  };
});

import { auditObjectName } from "@/lib/audit-labels";
import { prisma } from "@/server/db";
import {
  EngineUnavailableError,
  engineClient,
  type ImportResult,
  type QualityResponse,
  type QualitySignal,
} from "@/server/engine/client";
import { listAuditEvents } from "@/server/audit";
import { measurementRow } from "@/server/imports";
import type { LabContext } from "@/server/lab-context";
import { createProject } from "@/server/projects";
import { getStudyQuality, recordQualityDecision } from "@/server/quality";
import { archiveStudy, createStudy } from "@/server/studies";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const quality = vi.mocked(engineClient.quality);
type Rec = ImportResult["records"][number];
const RECORD: Rec = {
  sample_id: "16",
  aliquot: "a",
  record_type: "sample",
  matrix: "whole_blood",
  matrix_detail: "",
  polymer: "PE",
  polymer_raw: "pe",
  method: "Py-GC/MS",
  technique: "py_gc_ms",
  reported_value: "5",
  value: 5,
  unit: "ug/mL",
  canonical_value: 5,
  canonical_unit: "ug/mL",
  status: "quantified",
  lod: 0.1,
  loq: 0.3,
  canonical_lod: 0.1,
  canonical_loq: 0.3,
  identification_status: "confirmed",
  size_min_um: 1,
  size_max_um: 5,
  analysis_date: "2024-01-02",
  batch: "B1",
  lab: "L",
  comment: "c",
  source_row: 2,
  source_column: "PE",
};
const K1 = "a1".padEnd(64, "0");
const K2 = "b2".padEnd(64, "0");
const K9 = "c9".padEnd(64, "0");

const SIGNAL_1 = {
  key: K1,
  rule: "robust_outlier",
  category: "distribution",
  title: "Valeur atypique",
  subject_label: "Échantillon 16",
  explanation: "texte",
  group: {
    polymer: "PE",
    method: "Py-GC/MS",
    matrix: "whole_blood",
    matrix_detail: "",
    kind: "mass_concentration",
    basis: "per_volume",
    canonical_unit: "ug/mL",
  },
  sample_id: "16",
  figures: [{ name: "z", label: "Score z", value: 20.57, unit: null }],
  records: [] as unknown[],
} as unknown as QualitySignal;
const SIGNAL_2 = { ...SIGNAL_1, key: K2, subject_label: "Échantillon 4" } as QualitySignal;
const RESPONSE: QualityResponse = {
  quality_rules_version: "q1",
  signals: [SIGNAL_1, SIGNAL_2],
  notes: [],
  rules: [],
};

let ctx: LabContext; // viewer
let researcher: LabContext;
let labId: string;
let studyId: string;
let n = 0;

beforeEach(async () => {
  await resetDb();
  n = 0;
  quality.mockReset();
  quality.mockResolvedValue(RESPONSE);
  const lab = await makeLab("Labo");
  labId = lab.id;
  ctx = await makeMember(lab, "viewer", "v@example.org", "Vera");
  researcher = await makeMember(lab, "researcher", "r@example.org", "Rita");
  const p = await createProject(researcher, { title: "P" });
  studyId = await newStudy(researcher, p.id, "E");
});

async function newStudy(c: LabContext, projectId: string, title: string) {
  return (await createStudy(c, projectId, { title, nature: "laboratory", blankCorrected: "unknown" })).id;
}

async function addImport(
  opts: { study?: string; sheet?: string | null; records?: Partial<Rec>[] } = {},
) {
  n += 1;
  const sid = opts.study ?? studyId;
  const file = await prisma.dataFile.create({
    data: {
      studyId: sid,
      originalName: `f${n}.csv`,
      sha256: `${n}`.repeat(64).slice(0, 64),
      sizeBytes: 1,
      mimeType: "text/csv",
      storagePath: `p${n}`,
      uploadedById: researcher.userId,
    },
  });
  const run = await prisma.importRun.create({
    data: {
      studyId: sid,
      dataFileId: file.id,
      mapping: {},
      frozenContext: {},
      rulesVersion: "r1",
      engineVersion: "e",
      issues: [],
      status: "active",
      sheet: opts.sheet ?? null,
      createdById: researcher.userId,
    },
  });
  await prisma.measurement.createMany({
    data: (opts.records ?? [{}]).map((o) => ({
      ...measurementRow({ ...RECORD, ...o }),
      studyId: sid,
      importRunId: run.id,
    })),
  });
  return { run, file };
}

const counts = async () => ({
  predictions: await prisma.modelPrediction.count(),
  audits: await prisma.auditEvent.count({ where: { action: "quality.decision" } }),
});

async function decide(key: string, decision = "to_check", note: string | null = null) {
  return recordQualityDecision(researcher, studyId, { signalKey: key, decision, note });
}

describe("getStudyQuality", () => {
  it("sans import actif : empty, le moteur n'est pas appelé", async () => {
    expect(await getStudyQuality(ctx, studyId)).toEqual({ kind: "empty", disappeared: [] });
    expect(quality).not.toHaveBeenCalled();
  });

  it("requête : identité des cellules, ordre, contrôles de l'étude, blanc corrigé actuel", async () => {
    const csv = await addImport({ records: [{ source_row: 3 }, { source_row: 2 }] });
    const xlsx = await addImport({ sheet: "Feuille1", records: [{ source_row: 2 }] });
    const other = await newStudy(researcher, (await createProject(researcher, { title: "Q" })).id, "Autre");
    const base = { kind: "procedural_blank", n: 3, unitCode: "ug/mL", source: "s", mean: 1 };
    const mine = await prisma.qualityControlSummary.create({ data: { ...base, studyId, polymer: "PE" } });
    await prisma.qualityControlSummary.create({ data: { ...base, studyId: other, polymer: "PS" } });
    await prisma.study.update({ where: { id: studyId }, data: { blankCorrected: "yes" } });

    await getStudyQuality(ctx, studyId);
    const req = quality.mock.calls[0][0];
    expect(req.records.map((r) => [r.import_id, r.file_sha256, r.sheet, r.source_row])).toEqual([
      [csv.run.id, csv.file.sha256, "", 2],
      [csv.run.id, csv.file.sha256, "", 3],
      [xlsx.run.id, xlsx.file.sha256, "Feuille1", 2],
    ]);
    expect(req.qc_summaries?.map((q) => q.id)).toEqual([mine.id]);
    expect(req.blank_corrected).toBe("yes");
  });

  it("association : la décision la plus récente, count, signaux disparus, autre étude ignorée", async () => {
    await addImport();
    await decide(K1, "to_check");
    await decide(K1, "justified", "ok");
    await prisma.modelPrediction.create({
      data: {
        studyId,
        kind: "quality",
        input: { signalKey: K9, decision: "to_check" },
        output: SIGNAL_1 as never,
        modelName: "quality-rules",
        modelVersion: "q1",
      },
    });
    // prédiction d'une étude de B à clé identique
    const labB = await makeLab("B");
    const b = await makeMember(labB, "researcher", "b@example.org");
    const sB = await newStudy(b, (await createProject(b, { title: "PB" })).id, "EB");
    await prisma.modelPrediction.create({
      data: {
        studyId: sB,
        kind: "quality",
        input: { signalKey: K1, decision: "entry_error" },
        output: SIGNAL_1 as never,
        modelName: "quality-rules",
        modelVersion: "q1",
        status: "accepted",
      },
    });

    const r = await getStudyQuality(ctx, studyId);
    if (r.kind !== "ok") throw new Error("ok attendu");
    const s1 = r.signals.find((s) => s.signal.key === K1)!;
    expect(s1.decision).toMatchObject({
      decision: "justified",
      status: "rejected",
      note: "ok",
      count: 2,
      decidedBy: "Rita",
    });
    expect(r.signals.find((s) => s.signal.key === K2)!.decision).toBeNull();
    expect(r.disappeared.map((d) => d.signalKey)).toEqual([K9]);
    expect(r.version).toBe("q1");
    expect(r.archived).toBe(false);
  });

  it("même clé dans une autre étude du même laboratoire : ni affichée ni utilisée", async () => {
    await addImport();
    const other = await newStudy(researcher, (await createProject(researcher, { title: "Q2" })).id, "Autre");
    await prisma.modelPrediction.create({
      data: {
        studyId: other,
        kind: "quality",
        input: { signalKey: K1, decision: "entry_error" },
        output: SIGNAL_1 as never,
        modelName: "quality-rules",
        modelVersion: "q1",
        status: "accepted",
      },
    });
    const r = await getStudyQuality(ctx, studyId);
    if (r.kind !== "ok") throw new Error("ok attendu");
    expect(r.signals.find((s) => s.signal.key === K1)!.decision).toBeNull();
    expect(r.disappeared).toEqual([]);
  });

  it("moteur indisponible : EngineUnavailableError relancée", async () => {
    await addImport();
    quality.mockRejectedValue(new EngineUnavailableError());
    await expect(getStudyQuality(ctx, studyId)).rejects.toBeInstanceOf(EngineUnavailableError);
  });

  it("sans import actif mais avec une décision : empty, listée parmi les disparus", async () => {
    const { run } = await addImport();
    await decide(K1);
    await prisma.importRun.update({ where: { id: run.id }, data: { status: "retired" } });
    const r = await getStudyQuality(ctx, studyId);
    expect(r.kind).toBe("empty");
    expect(r.disappeared.map((d) => d.signalKey)).toEqual([K1]);
  });
});

describe("recordQualityDecision", () => {
  it.each([
    ["justified", "rejected", "raison"],
    ["to_check", "proposed", null],
    ["entry_error", "accepted", "faute de frappe secrète"],
  ])("écrit la décision %s", async (decision, status, note) => {
    const { run } = await addImport();
    const sig = {
      ...SIGNAL_1,
      records: [{ import_id: run.id }, { import_id: run.id }],
    } as unknown as QualitySignal;
    quality.mockResolvedValue({ ...RESPONSE, signals: [sig, SIGNAL_2] });
    const { id } = await decide(K1, decision, note);
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      studyId,
      kind: "quality",
      modelName: "quality-rules",
      modelVersion: "q1",
      status,
      decisionNote: note,
      decidedById: researcher.userId,
      inputFileSha256: null,
      score: null,
    });
    expect(row.decidedAt).not.toBeNull();
    expect(row.input).toEqual({ signalKey: K1, rule: "robust_outlier", decision, importIds: [run.id] });
    expect(row.output).toEqual(sig);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "quality.decision" } });
    expect(audit).toMatchObject({ entityType: "ModelPrediction", entityId: id, laboratoryId: labId });
    expect(audit.after).toMatchObject({
      studyId,
      signalKey: K1,
      rule: "robust_outlier",
      ruleTitle: "Valeur atypique",
      subject: "Échantillon 16",
      decision,
      modelVersion: "q1",
      hasNote: note !== null,
    });
    expect(JSON.stringify(audit.after)).not.toContain("faute de frappe");
    expect(JSON.stringify(audit.after)).not.toContain("raison");
  });

  it("le journal contient l'événement et nomme l'objet", async () => {
    await addImport();
    await decide(K1);
    const events = await listAuditEvents(ctx, studyId);
    const e = events.find((x) => x.action === "quality.decision")!;
    expect(e).toBeDefined();
    expect(auditObjectName(e)).toBe("Valeur atypique — Échantillon 16");
  });

  it("note rognée, 1 000 caractères acceptés, champs forgés ignorés", async () => {
    await addImport();
    const a = await recordQualityDecision(researcher, studyId, {
      signalKey: K1,
      decision: "justified",
      note: "  motif  ",
      rule: "near_blank",
      status: "accepted",
      output: { forged: true },
    } as never);
    const rowA = await prisma.modelPrediction.findUniqueOrThrow({ where: { id: a.id } });
    expect(rowA.decisionNote).toBe("motif");
    expect(rowA.status).toBe("rejected");
    expect(rowA.input).toMatchObject({ rule: "robust_outlier" });
    expect(rowA.output).toEqual(SIGNAL_1);
    const b = await decide(K1, "to_check", "x".repeat(1000));
    const rowB = await prisma.modelPrediction.findUniqueOrThrow({ where: { id: b.id } });
    expect(rowB.decisionNote).toHaveLength(1000);
  });

  it("décisions de suite : createdAt strictement croissant", async () => {
    await addImport();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await decide(K1)).id);
    const rows = await prisma.modelPrediction.findMany({ where: { id: { in: ids } } });
    const times = ids.map((id) => rows.find((r) => r.id === id)!.createdAt.getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  describe("refus sans écriture", () => {
    async function refused(run: () => Promise<unknown>, message: string) {
      const before = await counts();
      await expect(run()).rejects.toThrow(message);
      expect(await counts()).toEqual(before);
    }

    it("clé absente", async () => {
      await addImport();
      await refused(() => decide(K9), "Ce signal n'existe plus : rechargez la page.");
    });

    it("étude archivée, sans appel au moteur", async () => {
      await addImport();
      await archiveStudy(researcher, studyId, "fin");
      quality.mockClear();
      await refused(() => decide(K1), "Étude archivée : lecture seule.");
      expect(quality).not.toHaveBeenCalled();
    });

    it("viewer", async () => {
      await addImport();
      quality.mockClear();
      await refused(
        () => recordQualityDecision(ctx, studyId, { signalKey: K1, decision: "to_check" }),
        "Action réservée aux chercheurs du laboratoire.",
      );
      expect(quality).not.toHaveBeenCalled();
    });

    it("note manquante sur justified et entry_error", async () => {
      await addImport();
      await refused(() => decide(K1, "justified", "  "), "Une note est obligatoire pour cette décision.");
      await refused(() => decide(K1, "entry_error", null), "Une note est obligatoire pour cette décision.");
    });

    it("note de 1 001 caractères", async () => {
      await addImport();
      await refused(() => decide(K1, "to_check", "x".repeat(1001)), "La note dépasse 1 000 caractères.");
    });

    it("décision inconnue", async () => {
      await addImport();
      await refused(() => decide(K1, "autre"), "Décision inconnue.");
    });

    it("autre laboratoire", async () => {
      await addImport();
      const labB = await makeLab("B");
      const b = await makeMember(labB, "researcher", "b@example.org");
      quality.mockClear();
      await refused(
        () => recordQualityDecision(b, studyId, { signalKey: K1, decision: "to_check" }),
        "Étude introuvable.",
      );
      expect(quality).not.toHaveBeenCalled();
    });

    it("clé mal formée : refus avant tout appel au moteur", async () => {
      await addImport();
      quality.mockClear();
      for (const bad of ["k1", "A1".padEnd(64, "0"), "a1".padEnd(65, "0"), ""]) {
        await refused(() => decide(bad), "Ce signal n'existe plus : rechargez la page.");
      }
      expect(quality).not.toHaveBeenCalled();
    });

    it("note qui n'est pas du texte : erreur de validation normale", async () => {
      await addImport();
      await refused(
        () => decide(K1, "justified", 42 as unknown as string),
        "Une note est obligatoire pour cette décision.",
      );
    });
  });
});
