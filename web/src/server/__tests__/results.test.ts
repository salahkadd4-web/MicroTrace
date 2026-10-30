import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return {
    ...actual,
    engineClient: { validateContext: vi.fn(async () => ({})), summary: vi.fn() },
  };
});

import { prisma } from "@/server/db";
import {
  EngineUnavailableError,
  engineClient,
  type ImportResult,
} from "@/server/engine/client";
import type { LabContext } from "@/server/lab-context";
import { measurementRow } from "@/server/imports";
import { createProject } from "@/server/projects";
import { getStudyResults, loadActiveResultsInput } from "@/server/results";
import { archiveStudy, buildStudyContext, createStudy } from "@/server/studies";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const summary = vi.mocked(engineClient.summary);
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
  reported_value: "1.5",
  value: 1.5,
  unit: "ug/mL",
  canonical_value: 1.5,
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
  source_column: "PET",
};
const SUMMARY = { frequencies: [], stats: [], samples: [], aggregation_rule: "règle" };

let ctx: LabContext;
let studyId: string;
let n = 0;

beforeEach(async () => {
  await resetDb();
  n = 0;
  summary.mockReset();
  summary.mockResolvedValue(SUMMARY as never);
  const lab = await makeLab("Labo");
  ctx = await makeMember(lab, "viewer", "v@example.org", "Vera");
  const researcher = await makeMember(lab, "researcher", "r@example.org", "Rita");
  const p = await createProject(researcher, { title: "P" });
  studyId = (
    await createStudy(researcher, p.id, {
      title: "E",
      nature: "laboratory",
      blankCorrected: "unknown",
    })
  ).id;
});

async function addImport(
  opts: {
    status?: "active" | "retired";
    rulesVersion?: string;
    context?: object;
    createdAt?: Date;
    records?: Partial<Rec>[];
    qc?: Partial<Rec>[];
  } = {},
) {
  n += 1;
  const context = opts.context ?? (await buildStudyContext(ctx, studyId));
  const file = await prisma.dataFile.create({
    data: {
      studyId,
      originalName: `f${n}.csv`,
      sha256: `sha${n}`,
      sizeBytes: 1,
      mimeType: "text/csv",
      storagePath: `p${n}`,
      uploadedById: ctx.userId,
    },
  });
  const run = await prisma.importRun.create({
    data: {
      studyId,
      dataFileId: file.id,
      mapping: {},
      frozenContext: context,
      rulesVersion: opts.rulesVersion ?? "r1",
      engineVersion: "e",
      issues: [],
      status: opts.status ?? "active",
      createdById: ctx.userId,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  const rows = (opts.records ?? [{}]).map((o) => ({
    ...measurementRow({ ...RECORD, ...o }),
    studyId,
    importRunId: run.id,
  }));
  await prisma.measurement.createMany({ data: rows });
  const qc = (opts.qc ?? []).map((o) => ({
    ...measurementRow({ ...RECORD, record_type: "procedural_blank", ...o }),
    studyId,
    importRunId: run.id,
  }));
  if (qc.length) await prisma.qcMeasurement.createMany({ data: qc });
  return run;
}

describe("getStudyResults", () => {
  it("aucune mesure active : { empty: true } sans appeler le moteur", async () => {
    await addImport({ status: "retired" });
    expect(await getStudyResults(ctx, studyId)).toEqual({ empty: true });
    expect(summary).not.toHaveBeenCalled();
  });

  it("deux imports actifs et un retiré : le retiré est exclu, tri import/ligne/colonne", async () => {
    // L'import le plus récent est inséré en premier, avec une ligne source plus basse.
    await addImport({
      createdAt: new Date("2024-01-02"),
      records: [{ sample_id: "C1", source_row: 1 }],
    });
    await addImport({
      createdAt: new Date("2024-01-01"),
      records: [
        { sample_id: "B2", source_row: 5, source_column: "PE" },
        { sample_id: "B1", source_row: 2, source_column: "PS" },
        { sample_id: "B0", source_row: 2, source_column: "PET" },
        { sample_id: "B9", source_row: 10, source_column: "PE" },
      ],
    });
    await addImport({ status: "retired", records: [{ sample_id: "X" }] });
    const r = await getStudyResults(ctx, studyId);
    if (r.empty) throw new Error("résultats attendus");
    const sent = summary.mock.calls[0][0].records.map((x) => x.sample_id);
    expect(sent).toEqual(["B0", "B1", "B2", "B9", "C1"]);
    expect(r.imports.map((i) => i.fileName)).toEqual(["f2.csv", "f1.csv"]);
    expect(r.imports[0]).toMatchObject({ sha256: "sha2", rulesVersion: "r1", author: "Vera" });
    expect(r.nature).toBe("laboratory");
    expect(r.summary).toEqual(SUMMARY);
    expect(r.mixedRulesVersions).toBe(false);
    expect(r.contextChanged).toBe(false);
  });

  it("deux rulesVersion différentes : mixedRulesVersions", async () => {
    await addImport({ rulesVersion: "r1", createdAt: new Date("2024-01-01") });
    await addImport({ rulesVersion: "r2", createdAt: new Date("2024-01-02") });
    expect(await getStudyResults(ctx, studyId)).toMatchObject({ mixedRulesVersions: true });
  });

  it("contextChanged : faux si les contextes sont égaux, même avec un ordre de clés différent", async () => {
    const c = (await buildStudyContext(ctx, studyId)) as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(c).reverse());
    await addImport({ context: c, createdAt: new Date("2024-01-01") });
    await addImport({ context: reversed, createdAt: new Date("2024-01-02") });
    expect(await getStudyResults(ctx, studyId)).toMatchObject({ contextChanged: false });
  });

  it("contextChanged : vrai si les contextes figés des imports diffèrent", async () => {
    const c = await buildStudyContext(ctx, studyId);
    await addImport({ context: c, createdAt: new Date("2024-01-01") });
    await addImport({
      context: { ...c, blank_corrected: "yes" },
      createdAt: new Date("2024-01-02"),
    });
    expect(await getStudyResults(ctx, studyId)).toMatchObject({ contextChanged: true });
  });

  it("contextChanged : vrai si les paramètres actuels de l'étude diffèrent du contexte figé", async () => {
    const c = await buildStudyContext(ctx, studyId);
    await addImport({ context: c });
    await prisma.study.update({ where: { id: studyId }, data: { blankCorrected: "yes" } });
    expect(await getStudyResults(ctx, studyId)).toMatchObject({ contextChanged: true });
  });

  it("moteur indisponible : EngineUnavailableError", async () => {
    await addImport();
    summary.mockRejectedValue(new EngineUnavailableError());
    await expect(getStudyResults(ctx, studyId)).rejects.toThrow(
      "Le moteur d'analyse est indisponible.",
    );
  });

  it("autre laboratoire : « Étude introuvable. »", async () => {
    await addImport();
    const other = await makeMember(await makeLab("Autre"), "viewer", "o@example.org");
    await expect(getStudyResults(other, studyId)).rejects.toThrow("Étude introuvable.");
    await expect(loadActiveResultsInput(other, studyId)).rejects.toThrow("Étude introuvable.");
  });

  it("une étude archivée reste lisible", async () => {
    await addImport();
    const admin = await makeMember(
      { id: ctx.laboratoryId, slug: ctx.labSlug, name: ctx.labName },
      "lab_admin",
      "a@example.org",
    );
    await archiveStudy(admin, studyId, "fin");
    expect((await getStudyResults(ctx, studyId)).empty).toBe(false);
  });
});

describe("loadActiveResultsInput", () => {
  it("renvoie imports, mesures, contrôles qualité triés et le contexte à utiliser", async () => {
    const c = await buildStudyContext(ctx, studyId);
    await addImport({
      context: { ...c, blank_corrected: "yes" },
      createdAt: new Date("2024-01-02"),
      qc: [{ sample_id: "Q3", source_row: 1 }],
    });
    await addImport({
      context: c,
      createdAt: new Date("2024-01-01"),
      qc: [
        { sample_id: "Q2", source_row: 9 },
        { sample_id: "Q1", source_row: 3 },
      ],
    });
    await addImport({ status: "retired", qc: [{ sample_id: "QX" }] });
    const r = await loadActiveResultsInput(ctx, studyId);
    expect(r.qcRecords.map((x) => x.sample_id)).toEqual(["Q1", "Q2", "Q3"]);
    expect(r.records).toHaveLength(2);
    expect(r.imports).toHaveLength(2);
    expect(r.imports[0].frozenContext).toEqual(c); // le plus ancien d'abord
    expect(r.contextChanged).toBe(true);
    expect(r.context).toEqual({ ...c, blank_corrected: "yes" });
    expect(r.study).toMatchObject({ id: studyId, nature: "laboratory" });
  });

  it("colonnes triées par unités de code, sans collation", async () => {
    await addImport({
      records: ["É", "b", "B", "a", "_"].map((col, i) => ({
        sample_id: `K${i}`,
        source_row: 1,
        source_column: col,
      })),
    });
    const r = await loadActiveResultsInput(ctx, studyId);
    expect(r.records.map((x) => x.source_column)).toEqual(["B", "_", "a", "b", "É"]);
  });

  it("3 imports : l'ancien égale le contexte actuel, le plus récent diffère", async () => {
    const c = await buildStudyContext(ctx, studyId);
    const other = { ...c, blank_corrected: "yes" };
    await addImport({ context: c, createdAt: new Date("2024-01-01") });
    await addImport({ context: other, createdAt: new Date("2024-01-02") });
    await addImport({ context: other, createdAt: new Date("2024-01-03") });
    const r = await loadActiveResultsInput(ctx, studyId);
    expect(r.context).toEqual(other);
    expect(r.contextChanged).toBe(true);
  });

  it("contexte unique : c'est le contexte partagé", async () => {
    const c = await buildStudyContext(ctx, studyId);
    await addImport({ context: c });
    expect((await loadActiveResultsInput(ctx, studyId)).context).toEqual(c);
  });
});
