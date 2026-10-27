import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
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
      suggestMapping: vi.fn(),
      checkImport: vi.fn(),
    },
  };
});

const dir = mkdtempSync(path.join(tmpdir(), "mt-imports-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

import { listAuditEvents } from "@/server/audit";
import { prisma } from "@/server/db";
import {
  EngineUnavailableError,
  engineClient,
  type ImportResult,
  type Mapping,
} from "@/server/engine/client";
import type { LabContext } from "@/server/lab-context";
import { putStaging } from "@/server/file-store";
import {
  checkStagedImport,
  existingKeys,
  getImport,
  listImports,
  measurementRow,
  retireImport,
  saveImport,
  suggestStagedMapping,
} from "@/server/imports";
import { createProject } from "@/server/projects";
import { archiveStudy, createStudy } from "@/server/studies";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const check = vi.mocked(engineClient.checkImport);
const suggest = vi.mocked(engineClient.suggestMapping);

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

const MAPPING: Mapping = {
  mode: "long",
  field_columns: { sample_id: "id" },
  split_aliquot_suffix: false,
};

function result(over: Partial<ImportResult> = {}): ImportResult {
  return {
    records: [RECORD, { ...RECORD, polymer: "PE", source_row: 3 }],
    qc_records: [
      {
        ...RECORD,
        sample_id: "QC1",
        record_type: "procedural_blank",
        value: null,
        canonical_value: null,
        source_row: 4,
      },
    ],
    issues: [],
    n_rows: 3,
    rules_version: "r1",
    has_errors: false,
    counts: { error: 0, warning: 0, info: 0 },
    engine_version: "e1",
    sha256: "x",
    sheet: null,
    ...over,
  };
}

const issue = (code: string, severity: "error" | "warning" | "info") =>
  ({ code, severity, message: "m" }) as ImportResult["issues"][number];

let lab: Awaited<ReturnType<typeof makeLab>>;
let ctx: LabContext;
let studyId: string;

beforeEach(async () => {
  await resetDb();
  rmSync(path.join(dir, "staging"), { recursive: true, force: true });
  rmSync(path.join(dir, "files"), { recursive: true, force: true });
  check.mockReset();
  check.mockResolvedValue(result());
  suggest.mockReset();
  lab = await makeLab("Labo");
  ctx = await makeMember(lab, "researcher", "a@example.org", "Alice");
  const p = await createProject(ctx, { title: "P" });
  studyId = (
    await createStudy(ctx, p.id, {
      title: "E",
      nature: "laboratory",
      blankCorrected: "unknown",
    })
  ).id;
});

async function stage(content = "a,b\n1,2\n", name = "données.csv") {
  const bytes = new TextEncoder().encode(content);
  return putStaging(
    { userId: ctx.userId, laboratoryId: ctx.laboratoryId, studyId },
    { name, type: "text/csv", bytes },
  );
}
const input = (token: string, extra: object = {}) => ({
  token,
  sheet: null,
  mapping: MAPPING,
  acceptWarnings: false,
  ...extra,
});
const stagingFiles = () =>
  existsSync(path.join(dir, "staging"))
    ? readdirSync(path.join(dir, "staging"))
    : [];
const storedFiles = () =>
  existsSync(path.join(dir, "files")) ? readdirSync(path.join(dir, "files")) : [];

describe("measurementRow", () => {
  it("chaque clé d'un MeasurementRecordModel complet arrive dans la ligne (aucun champ perdu)", () => {
    const row = measurementRow(RECORD) as Record<string, unknown>;
    const RENAMED: Record<string, string> = {
      unit: "unitCode",
      canonical_unit: "canonicalUnitCode",
    };
    const camel = (k: string) =>
      RENAMED[k] ?? k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    expect(Object.keys(RECORD)).toHaveLength(28);
    for (const [key, value] of Object.entries(RECORD)) {
      expect(row, key).toHaveProperty(camel(key), value);
    }
    expect(Object.keys(row)).toHaveLength(28);
  });

  it("null reste null (jamais 0)", () => {
    const row = measurementRow({
      ...RECORD,
      value: null,
      lod: null,
      canonical_loq: null,
    });
    expect(row.value).toBeNull();
    expect(row.lod).toBeNull();
    expect(row.canonicalLoq).toBeNull();
  });
});

describe("saveImport", () => {
  it("un enregistrement propre crée fichier, import, mesures, audit et efface le dépôt", async () => {
    const { token } = await stage();
    const { importRunId } = await saveImport(ctx, studyId, input(token));
    const run = await prisma.importRun.findUniqueOrThrow({
      where: { id: importRunId },
      include: { dataFile: true },
    });
    expect(run).toMatchObject({
      status: "active",
      rulesVersion: "r1",
      engineVersion: "e1",
      warningsAccepted: false,
      createdById: ctx.userId,
    });
    expect(run.frozenContext).toMatchObject({ data_nature: "laboratory" });
    expect(run.mapping).toEqual(MAPPING);
    expect(run.dataFile).toMatchObject({
      originalName: "données.csv",
      mimeType: "text/csv",
      uploadedById: ctx.userId,
    });
    expect(run.dataFile.storagePath).toBe(`files/${run.dataFile.sha256}`);
    expect(await prisma.measurement.count({ where: { importRunId } })).toBe(2);
    expect(await prisma.qcMeasurement.count({ where: { importRunId } })).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "import.create" },
    });
    expect(audit).toMatchObject({
      entityType: "ImportRun",
      entityId: importRunId,
      laboratoryId: ctx.laboratoryId,
      actorId: ctx.userId,
    });
    expect(audit.after).toMatchObject({ fileName: "données.csv", rows: 3 });
    expect(stagingFiles()).toEqual([]);
    expect(storedFiles()).toEqual([run.dataFile.sha256]);
  });

  it("relance le contrôle à l'enregistrement : une erreur au second appel refuse et n'écrit rien", async () => {
    const { token } = await stage();
    check.mockResolvedValueOnce(result());
    await checkStagedImport(ctx, studyId, { token, sheet: null, mapping: MAPPING });
    check.mockResolvedValueOnce(
      result({
        has_errors: true,
        counts: { error: 1, warning: 0, info: 0 },
        issues: [issue("E_REQUIRED_MISSING", "error")],
      }),
    );
    await expect(saveImport(ctx, studyId, input(token))).rejects.toThrow(
      "Enregistrement impossible : le contrôle signale des erreurs.",
    );
    expect(await prisma.importRun.count()).toBe(0);
    expect(await prisma.dataFile.count()).toBe(0);
    expect(storedFiles()).toEqual([]);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("transmet le contexte et les clés existantes au moteur", async () => {
    const { token } = await stage();
    await saveImport(ctx, studyId, input(token));
    const call = check.mock.calls[0][0];
    expect(call.context).toMatchObject({ data_nature: "laboratory" });
    expect(call.existing).toEqual([]);
  });

  it("avertissements sans acceptation : refus ; avec acceptation : succès et warningsAccepted", async () => {
    check.mockResolvedValue(
      result({
        counts: { error: 0, warning: 1, info: 0 },
        issues: [issue("W_NO_LIMITS", "warning")],
      }),
    );
    const { token } = await stage();
    await expect(saveImport(ctx, studyId, input(token))).rejects.toThrow(
      "Acceptez les avertissements pour enregistrer.",
    );
    expect(await prisma.importRun.count()).toBe(0);
    expect(stagingFiles()).not.toEqual([]);
    const { importRunId } = await saveImport(
      ctx,
      studyId,
      input(token, { acceptWarnings: true }),
    );
    const run = await prisma.importRun.findUniqueOrThrow({
      where: { id: importRunId },
    });
    expect(run.warningsAccepted).toBe(true);
    expect(run.warningsAcceptedAt).toBeInstanceOf(Date);
    expect(run.warningsAcceptedById).toBe(ctx.userId);
    expect(run.warningCount).toBe(1);
  });

  it("même fichier deux fois : un seul actif, le second est refusé", async () => {
    const a = await stage();
    await saveImport(ctx, studyId, input(a.token));
    const b = await stage();
    await expect(saveImport(ctx, studyId, input(b.token))).rejects.toThrow(
      "Ce fichier a déjà un import actif dans cette étude.",
    );
    expect(await prisma.importRun.count({ where: { status: "active" } })).toBe(1);
  });

  it("deux enregistrements simultanés du même dépôt : un seul succès", async () => {
    const { token } = await stage();
    // Barrière : les deux enregistrements ont lu le dépôt avant que l'un des deux ne l'efface.
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((r) => (release = r));
    check.mockImplementation(async () => {
      if (++arrived === 2) release();
      await both;
      return result();
    });
    const outcomes = await Promise.allSettled([
      saveImport(ctx, studyId, input(token)),
      saveImport(ctx, studyId, input(token)),
    ]);
    const ok = outcomes.filter((o) => o.status === "fulfilled");
    const ko = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === "rejected",
    );
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect((ko[0].reason as Error).message).toBe(
      "Ce fichier a déjà un import actif dans cette étude.",
    );
    expect(await prisma.importRun.count({ where: { status: "active" } })).toBe(1);
    expect(await prisma.dataFile.count()).toBe(1);
    expect(await prisma.measurement.count()).toBe(2);
  });

  it("retrait puis réimport accepté ; les clés du retiré ne figurent plus dans existingKeys", async () => {
    const a = await stage();
    const { importRunId } = await saveImport(ctx, studyId, input(a.token));
    const keys = await existingKeys(ctx, studyId);
    expect(keys).toHaveLength(3);
    expect(keys).toContainEqual({
      sample_id: "S1",
      aliquot: "A",
      record_type: "sample",
      polymer: "PET",
      polymer_raw: "pet",
      method: "Py-GC/MS",
      matrix: "whole_blood",
      matrix_detail: "EDTA",
    });
    expect(keys.some((k) => k.sample_id === "QC1")).toBe(true);
    await retireImport(ctx, importRunId, "  erreur de saisie ");
    expect(await existingKeys(ctx, studyId)).toEqual([]);
    const b = await stage();
    const second = await saveImport(ctx, studyId, input(b.token));
    expect(second.importRunId).not.toBe(importRunId);
    expect(await prisma.dataFile.count()).toBe(1);
    expect(await prisma.importRun.count({ where: { status: "active" } })).toBe(1);
  });

  it("panne du moteur : EngineUnavailableError, rien d'écrit, dépôt conservé", async () => {
    check.mockRejectedValue(new EngineUnavailableError());
    const { token } = await stage();
    await expect(saveImport(ctx, studyId, input(token))).rejects.toBeInstanceOf(
      EngineUnavailableError,
    );
    expect(await prisma.importRun.count()).toBe(0);
    expect(await prisma.dataFile.count()).toBe(0);
    expect(storedFiles()).toEqual([]);
    expect(stagingFiles()).not.toEqual([]);
  });

  it("jeton inconnu : « Dépôt introuvable ou expiré. »", async () => {
    await expect(
      saveImport(ctx, studyId, input("x".repeat(43))),
    ).rejects.toThrow("Dépôt introuvable ou expiré.");
  });

  it("étude archivée et lecteur refusés", async () => {
    const { token } = await stage();
    const viewer = await makeMember(lab, "viewer", "v@example.org");
    await expect(saveImport(viewer, studyId, input(token))).rejects.toThrow(
      "Action réservée aux chercheurs du laboratoire.",
    );
    await archiveStudy(ctx, studyId, "fin");
    await expect(saveImport(ctx, studyId, input(token))).rejects.toThrow(
      "Étude archivée : lecture seule.",
    );
    expect(await prisma.importRun.count()).toBe(0);
  });
});

describe("données personnelles", () => {
  for (const code of ["E_PII_COLUMN", "E_PII_VALUE"]) {
    it(`${code} : dépôt effacé, rien en base ni dans files/, audit sans valeur`, async () => {
      check.mockResolvedValue(
        result({
          has_errors: true,
          counts: { error: 2, warning: 0, info: 0 },
          issues: [
            {
              ...issue(code, "error"),
              column: "Nom du patient",
              message: "Colonne personnelle",
            },
            issue(code, "error"),
          ],
        }),
      );
      const { token } = await stage("nom\nDupont\n", "secret-patients.csv");
      await expect(saveImport(ctx, studyId, input(token))).rejects.toThrow(
        "Import refusé : le fichier contient des données personnelles.",
      );
      expect(stagingFiles()).toEqual([]);
      expect(storedFiles()).toEqual([]);
      expect(await prisma.dataFile.count()).toBe(0);
      expect(await prisma.importRun.count()).toBe(0);
      expect(await prisma.measurement.count()).toBe(0);
      const audits = await prisma.auditEvent.findMany({
        where: { action: "import.refused_pii" },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        entityType: "Study",
        entityId: studyId,
        laboratoryId: ctx.laboratoryId,
      });
      expect(audits[0].after).toEqual({
        counts: { error: 2, warning: 0, info: 0 },
        codes: { [code]: 2 },
      });
      const dump = JSON.stringify(audits);
      expect(dump).not.toContain("secret-patients");
      expect(dump).not.toContain("Nom du patient");
      expect(dump).not.toContain("Dupont");
    });
  }

  it("checkStagedImport renvoie les issues sans les records, et efface le dépôt", async () => {
    check.mockResolvedValue(
      result({
        has_errors: true,
        counts: { error: 1, warning: 0, info: 0 },
        issues: [issue("E_PII_COLUMN", "error")],
      }),
    );
    const { token } = await stage();
    const r = await checkStagedImport(ctx, studyId, {
      token,
      sheet: null,
      mapping: MAPPING,
    });
    expect(r.records).toEqual([]);
    expect(r.qc_records).toEqual([]);
    expect(r.issues).toHaveLength(1);
    expect(stagingFiles()).toEqual([]);
    await expect(
      checkStagedImport(ctx, studyId, { token, sheet: null, mapping: MAPPING }),
    ).rejects.toThrow("Dépôt introuvable ou expiré.");
  });
});

describe("checkStagedImport et suggestStagedMapping", () => {
  it("un chercheur peut contrôler ; rien n'est écrit", async () => {
    const { token } = await stage();
    const r = await checkStagedImport(ctx, studyId, {
      token,
      sheet: null,
      mapping: MAPPING,
    });
    expect(r.n_rows).toBe(3);
    expect(await prisma.importRun.count()).toBe(0);
    expect(stagingFiles()).not.toEqual([]);
  });

  it("suggestStagedMapping lit le dépôt et appelle le moteur ; lecteur refusé", async () => {
    suggest.mockResolvedValue(MAPPING);
    const { token } = await stage();
    await expect(suggestStagedMapping(ctx, studyId, token)).resolves.toEqual(
      MAPPING,
    );
    const viewer = await makeMember(lab, "viewer", "v@example.org");
    await expect(suggestStagedMapping(viewer, studyId, token)).rejects.toThrow(
      "Action réservée aux chercheurs du laboratoire.",
    );
    await expect(
      checkStagedImport(viewer, studyId, { token, sheet: null, mapping: MAPPING }),
    ).rejects.toThrow("Action réservée aux chercheurs du laboratoire.");
  });
});

describe("retireImport", () => {
  async function saved() {
    const { token } = await stage();
    return (await saveImport(ctx, studyId, input(token))).importRunId;
  }

  it("retire avec motif rogné et audit before/after", async () => {
    const id = await saved();
    await retireImport(ctx, id, "  erreur  ");
    const run = await prisma.importRun.findUniqueOrThrow({ where: { id } });
    expect(run).toMatchObject({ status: "retired", retiredReason: "erreur" });
    expect(run.retiredAt).toBeInstanceOf(Date);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "import.retire" },
    });
    expect(audit.before).toMatchObject({ status: "active" });
    expect(audit.after).toMatchObject({ status: "retired", reason: "erreur" });
    expect(audit.laboratoryId).toBe(ctx.laboratoryId);
    expect(await prisma.measurement.count({ where: { importRunId: id } })).toBe(2);
  });

  it("motif obligatoire ; déjà retiré ; lecteur et étude archivée refusés", async () => {
    const id = await saved();
    await expect(retireImport(ctx, id, "   ")).rejects.toThrow(
      "Le motif de retrait est obligatoire.",
    );
    await retireImport(ctx, id, "m");
    await expect(retireImport(ctx, id, "m")).rejects.toThrow(
      "Import déjà retiré.",
    );
    const viewer = await makeMember(lab, "viewer", "v@example.org");
    await expect(retireImport(viewer, id, "m")).rejects.toThrow(
      "Action réservée aux chercheurs du laboratoire.",
    );
    const { token } = await stage();
    const id2 = (await saveImport(ctx, studyId, input(token))).importRunId;
    await archiveStudy(ctx, studyId, "fin");
    await expect(retireImport(ctx, id2, "m")).rejects.toThrow(
      "Étude archivée : lecture seule.",
    );
    expect(
      (await prisma.importRun.findUniqueOrThrow({ where: { id: id2 } })).status,
    ).toBe("active");
  });

  it("deux retraits simultanés : un seul réussit", async () => {
    const id = await saved();
    const out = await Promise.allSettled([
      retireImport(ctx, id, "a"),
      retireImport(ctx, id, "b"),
    ]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { action: "import.retire" } })).toBe(1);
  });
});

describe("listImports, getImport et journal", () => {
  it("liste du plus récent au plus ancien avec nom, statut, compteurs et auteur", async () => {
    const a = await stage("a\n", "a.csv");
    const first = (await saveImport(ctx, studyId, input(a.token))).importRunId;
    const b = await stage("b\n", "b.csv");
    const second = (await saveImport(ctx, studyId, input(b.token))).importRunId;
    await retireImport(ctx, first, "x");
    const list = await listImports(ctx, studyId);
    expect(list.map((i) => i.id)).toEqual([second, first]);
    expect(list[0]).toMatchObject({
      fileName: "b.csv",
      status: "active",
      errorCount: 0,
      createdByName: "Alice",
      measurementCount: 2,
      qcMeasurementCount: 1,
    });
    expect(list[1]).toMatchObject({ status: "retired", retiredReason: "x" });
    const viewer = await makeMember(lab, "viewer", "v@example.org");
    expect(await listImports(viewer, studyId)).toHaveLength(2);
    const detail = await getImport(viewer, first);
    expect(detail).toMatchObject({ id: first, fileName: "a.csv", issues: [] });
  });

  it("le journal de l'étude contient les événements d'import et de refus PII", async () => {
    const a = await stage();
    const id = (await saveImport(ctx, studyId, input(a.token))).importRunId;
    await retireImport(ctx, id, "m");
    check.mockResolvedValue(
      result({
        has_errors: true,
        counts: { error: 1, warning: 0, info: 0 },
        issues: [issue("E_PII_VALUE", "error")],
      }),
    );
    const b = await stage("z\n", "z.csv");
    await checkStagedImport(ctx, studyId, {
      token: b.token,
      sheet: null,
      mapping: MAPPING,
    });
    const actions = (await listAuditEvents(ctx, studyId)).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["import.create", "import.retire", "import.refused_pii"]),
    );
  });
});
