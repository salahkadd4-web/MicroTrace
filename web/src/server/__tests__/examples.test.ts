import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return {
    ...actual,
    engineClient: {
      validateContext: vi.fn(async () => ({})),
      example: vi.fn(),
      exampleLeslie2022: vi.fn(),
      suggestMapping: vi.fn(),
      checkImport: vi.fn(),
    },
  };
});

const dir = mkdtempSync(path.join(tmpdir(), "mt-examples-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

import { prisma } from "@/server/db";
import {
  EngineError,
  EngineUnavailableError,
  engineClient,
  type Example,
  type ImportResult,
} from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { createExampleStudy } from "@/server/examples";
import type { LabContext } from "@/server/lab-context";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const fictif = vi.mocked(engineClient.example);
const reel = vi.mocked(engineClient.exampleLeslie2022);
const check = vi.mocked(engineClient.checkImport);

const CSV = "id,PET\nS1,1.5\n";
const BASE: Example = {
  filename: "exemple.csv",
  csv_base64: Buffer.from(CSV).toString("base64"),
  mapping: { mode: "long", field_columns: { sample_id: "id" }, split_aliquot_suffix: false },
  context: {
    data_nature: "simulated",
    methods: [{ name: "Py-GC/MS", technique: "py_gc_ms" }],
    limits: [
      { method: "Py-GC/MS", polymer: "PET", lod: 0.1, loq: 0.3, unit_code: "ug/mL", source: "s" },
      { method: "Py-GC/MS", polymer: "PE", lod: null, loq: null, unit_code: "ug/mL", source: "s" },
    ],
    reference_doi: null,
    reference_license: null,
    blank_corrected: "unknown",
  },
};
const REEL: Example = {
  ...BASE,
  filename: "leslie.csv",
  context: {
    ...BASE.context,
    data_nature: "published",
    reference_doi: "10.1016/j.envint.2022.107199",
    reference_license: "CC BY 4.0",
    blank_corrected: "yes",
  },
};

function result(): ImportResult {
  const rec = {
    sample_id: "S1", aliquot: "A", record_type: "sample", matrix: "whole_blood",
    matrix_detail: "EDTA", polymer: "PET", polymer_raw: "pet", method: "Py-GC/MS",
    technique: "py_gc_ms", reported_value: "1.5", value: 1.5, unit: "ug/mL",
    canonical_value: 1.5, canonical_unit: "ug/mL", status: "quantified", lod: 0.1, loq: 0.3,
    canonical_lod: 0.1, canonical_loq: 0.3, identification_status: "confirmed",
    size_min_um: 1, size_max_um: 5, analysis_date: "2024-01-02", batch: "B1", lab: "L", comment: "c",
    source_row: 2, source_column: "PET",
  };
  return {
    records: [rec], qc_records: [],
    issues: [{ code: "W", severity: "warning", message: "m" }],
    n_rows: 1, rules_version: "r1", has_errors: false,
    counts: { error: 0, warning: 1, info: 0 }, engine_version: "e1", sha256: "x", sheet: null,
  } as unknown as ImportResult;
}

let ctx: LabContext;
let viewer: LabContext;
let labB: LabContext;

beforeEach(async () => {
  await resetDb();
  rmSync(path.join(dir, "staging"), { recursive: true, force: true });
  rmSync(path.join(dir, "files"), { recursive: true, force: true });
  fictif.mockReset().mockResolvedValue(BASE);
  reel.mockReset().mockResolvedValue(REEL);
  check.mockReset().mockResolvedValue(result());
  const lab = await makeLab("Labo");
  ctx = await makeMember(lab, "researcher", "a@example.org", "Alice");
  viewer = await makeMember(lab, "viewer", "v@example.org", "Val");
  labB = await makeMember(await makeLab("Autre"), "researcher", "b@example.org", "Bob");
});

describe("createExampleStudy", () => {
  it("l'exemple réel reste publié, avec DOI et licence, et crée un import actif", async () => {
    const out = await createExampleStudy(ctx, "leslie2022");
    const study = await prisma.study.findUniqueOrThrow({
      where: { id: out.studyId },
      include: { project: true, methods: true, limits: true },
    });
    expect(study.project.title).toBe("Exemple — Leslie et al. 2022 (réel)");
    expect(study.project.id).toBe(out.projectId);
    expect(study.title).toBe("Leslie et al. 2022 — Tableau S2 (sang total, Py-GC/MS)");
    expect(study.nature).toBe("published");
    expect(study.referenceDoi).toBe("10.1016/j.envint.2022.107199");
    expect(study.referenceLicense).toBe("CC BY 4.0");
    expect(study.blankCorrected).toBe("yes");
    expect(study.methods).toHaveLength(1);
    expect(study.limits).toHaveLength(2);
    const runs = await prisma.importRun.findMany({ where: { studyId: out.studyId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: out.importRunId, status: "active", errorCount: 0 });
    expect(reel).toHaveBeenCalledTimes(1);
    expect(fictif).not.toHaveBeenCalled();
  });

  it("l'exemple fictif est simulé", async () => {
    const out = await createExampleStudy(ctx, "fictif");
    const study = await prisma.study.findUniqueOrThrow({
      where: { id: out.studyId },
      include: { project: true },
    });
    expect(study.nature).toBe("simulated");
    expect(study.title).toBe("Étude fictive façon Leslie 2022");
    expect(study.project.title).toBe("Exemple — étude fictive façon Leslie");
    expect(study.referenceDoi).toBeNull();
  });

  it("l'import passe par le chemin commun : fichier stocké, auteur, audit", async () => {
    const out = await createExampleStudy(ctx, "fictif");
    const run = await prisma.importRun.findUniqueOrThrow({
      where: { id: out.importRunId },
      include: { dataFile: true },
    });
    expect(run.dataFile.originalName).toBe("exemple.csv");
    expect(run.dataFile.uploadedById).toBe(ctx.userId);
    expect(run.createdById).toBe(ctx.userId);
    expect(run.warningsAccepted).toBe(true);
    expect(await prisma.measurement.count({ where: { importRunId: out.importRunId } })).toBe(1);
    const actions = (await prisma.auditEvent.findMany()).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["project.create", "study.create", "study.method.add"]),
    );
  });

  it("chaque clic crée un nouvel exemple", async () => {
    await createExampleStudy(ctx, "fictif");
    await createExampleStudy(ctx, "fictif");
    expect(await prisma.project.count()).toBe(2);
    expect(await prisma.study.count()).toBe(2);
  });

  it("un lecteur est refusé, rien n'est écrit ni demandé au moteur", async () => {
    await expect(createExampleStudy(viewer, "fictif")).rejects.toThrow(
      "Action réservée aux chercheurs du laboratoire.",
    );
    expect(await prisma.project.count()).toBe(0);
    expect(fictif).not.toHaveBeenCalled();
  });

  it("moteur indisponible : erreur dédiée, rien n'est écrit", async () => {
    reel.mockRejectedValueOnce(new EngineUnavailableError());
    await expect(createExampleStudy(ctx, "leslie2022")).rejects.toBeInstanceOf(
      EngineUnavailableError,
    );
    expect(await prisma.project.count()).toBe(0);
  });

  it("moteur qui refuse une limite : message de configuration, projet et étude restent", async () => {
    vi.mocked(engineClient.validateContext)
      .mockResolvedValueOnce({ ok: true }) // createStudy
      .mockResolvedValueOnce({ ok: true }) // addMethod
      .mockRejectedValueOnce(new EngineError(422, "Limite incohérente."));
    await expect(createExampleStudy(ctx, "fictif")).rejects.toThrow(
      "L'étude d'exemple a été créée, mais sa configuration a échoué : Limite incohérente.",
    );
    expect(await prisma.project.count()).toBe(1);
    expect(await prisma.study.count()).toBe(1);
    expect(await prisma.detectionLimit.count()).toBe(0);
    expect(await prisma.importRun.count()).toBe(0);
  });

  it("moteur indisponible pendant createStudy : seul le projet reste, message dédié", async () => {
    vi.mocked(engineClient.validateContext).mockRejectedValueOnce(new EngineUnavailableError());
    await expect(createExampleStudy(ctx, "fictif")).rejects.toThrow(
      "Le projet d'exemple a été créé, mais la création de l'étude a échoué : Le moteur d'analyse est indisponible.",
    );
    expect(await prisma.project.count()).toBe(1);
    expect(await prisma.study.count()).toBe(0);
  });

  it("les exemples sont isolés par laboratoire", async () => {
    const a = await createExampleStudy(ctx, "fictif");
    const b = await createExampleStudy(labB, "leslie2022");
    const studyA = await prisma.study.findUniqueOrThrow({ where: { id: a.studyId } });
    const studyB = await prisma.study.findUniqueOrThrow({ where: { id: b.studyId } });
    expect(studyA.laboratoryId).toBe(ctx.laboratoryId);
    expect(studyB.laboratoryId).toBe(labB.laboratoryId);
    expect(await prisma.importRun.count({ where: { studyId: a.studyId } })).toBe(1);
    expect(await prisma.project.count({ where: { laboratoryId: ctx.laboratoryId } })).toBe(1);
  });

  it("refus 422 du moteur pendant l'import : son message français est conservé", async () => {
    check.mockRejectedValue(new EngineError(422, "Le fichier ne contient aucune ligne de données."));
    const err = await createExampleStudy(ctx, "fictif").then(
      () => null,
      (x: unknown) => x,
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as Error).message).toBe(
      "L'étude d'exemple a été créée, mais son import a échoué : Le fichier ne contient aucune ligne de données.",
    );
    expect(await prisma.study.count()).toBe(1);
  });

  it("import en échec : projet et étude restent, message clair", async () => {
    check.mockResolvedValue({
      ...result(),
      has_errors: true,
      counts: { error: 1, warning: 0, info: 0 },
    });
    const err = await createExampleStudy(ctx, "fictif").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as Error).message).toBe(
      "L'étude d'exemple a été créée, mais son import a échoué : Enregistrement impossible : le contrôle signale des erreurs.",
    );
    expect(await prisma.project.count()).toBe(1);
    expect(await prisma.study.count()).toBe(1);
    expect(await prisma.importRun.count()).toBe(0);
    expect(existsSync(path.join(dir, "staging"))).toBe(true);
  });
});

const live = process.env.ENGINE_URL && process.env.ENGINE_SECRET ? describe : describe.skip;
live("exemple réel avec le vrai moteur", () => {
  it("40 lignes-aliquotes × 5 polymères, un import actif, aucune erreur", async () => {
    const real = await vi.importActual<typeof import("@/server/engine/client")>(
      "@/server/engine/client",
    );
    reel.mockImplementation(() => real.engineClient.exampleLeslie2022());
    check.mockImplementation((a) => real.engineClient.checkImport(a));
    vi.mocked(engineClient.validateContext).mockImplementation((c) =>
      real.engineClient.validateContext(c),
    );
    const out = await createExampleStudy(ctx, "leslie2022");
    const runs = await prisma.importRun.findMany({ where: { studyId: out.studyId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "active", errorCount: 0 });
    expect(await prisma.measurement.count({ where: { importRunId: out.importRunId } })).toBe(200);
  });
});
