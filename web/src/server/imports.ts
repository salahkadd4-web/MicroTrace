import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import {
  engineClient,
  type ExistingKey,
  type ImportResult,
  type Mapping,
  type StudyContext,
} from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import {
  deleteStaging,
  readStaging,
  storeFile,
  type StagingOwner,
} from "@/server/file-store";
import type { LabContext } from "@/server/lab-context";
import { assertRole } from "@/server/lab-role";
import { buildStudyContext, loadWritable } from "@/server/studies";

type MeasurementRecord = ImportResult["records"][number];
type MeasurementColumns = Omit<
  Prisma.MeasurementCreateManyInput,
  "id" | "importRunId" | "studyId"
>;

/**
 * Correspondance explicite champ du moteur (snake_case) -> colonne (camelCase). Le type
 * `Record<keyof MeasurementRecord, ...>` oblige à la mettre à jour si le moteur ajoute un champ :
 * aucun champ ne peut être perdu en silence.
 */
const COLUMN_OF: Record<keyof MeasurementRecord, keyof MeasurementColumns> = {
  sample_id: "sampleId",
  aliquot: "aliquot",
  record_type: "recordType",
  matrix: "matrix",
  matrix_detail: "matrixDetail",
  polymer: "polymer",
  polymer_raw: "polymerRaw",
  method: "method",
  technique: "technique",
  reported_value: "reportedValue",
  value: "value",
  unit: "unitCode",
  canonical_value: "canonicalValue",
  canonical_unit: "canonicalUnitCode",
  status: "status",
  lod: "lod",
  loq: "loq",
  canonical_lod: "canonicalLod",
  canonical_loq: "canonicalLoq",
  identification_status: "identificationStatus",
  size_min_um: "sizeMinUm",
  size_max_um: "sizeMaxUm",
  analysis_date: "analysisDate",
  batch: "batch",
  lab: "lab",
  comment: "comment",
  source_row: "sourceRow",
  source_column: "sourceColumn",
};

/** Record du moteur -> colonnes de `Measurement` / `QcMeasurement` (null reste null). */
export function measurementRow(record: MeasurementRecord): MeasurementColumns {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(COLUMN_OF) as (keyof MeasurementRecord)[]) {
    row[COLUMN_OF[key]] = record[key];
  }
  return row as MeasurementColumns;
}

const PII_CODES: ReadonlySet<string> = new Set(["E_PII_COLUMN", "E_PII_VALUE"]);
const PII_REFUSED = "Import refusé : le fichier contient des données personnelles.";
const DUPLICATE = "Ce fichier a déjà un import actif dans cette étude.";
const SAVE_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

function owner(ctx: LabContext, studyId: string): StagingOwner {
  return { userId: ctx.userId, laboratoryId: ctx.laboratoryId, studyId };
}

/** Étude du laboratoire du contexte, sinon « Étude introuvable. » (même réponse qu'un identifiant inconnu). */
async function requireStudy(ctx: LabContext, studyId: string) {
  const study = await prisma.study.findFirst({
    where: { id: studyId, laboratoryId: ctx.laboratoryId },
    select: { id: true },
  });
  if (!study) throw new DomainError("Étude introuvable.");
}

/** Clés des mesures (et contrôles qualité) des imports actifs de l'étude, au format du moteur. */
export async function existingKeys(
  ctx: LabContext,
  studyId: string,
): Promise<ExistingKey[]> {
  assertRole(ctx, "viewer");
  await requireStudy(ctx, studyId);
  const where = {
    studyId,
    study: { laboratoryId: ctx.laboratoryId },
    importRun: { status: "active" as const },
  };
  const select = {
    sampleId: true,
    aliquot: true,
    recordType: true,
    polymer: true,
    polymerRaw: true,
    method: true,
    matrix: true,
    matrixDetail: true,
  } as const;
  const [measurements, qcs] = await Promise.all([
    prisma.measurement.findMany({ where, select }),
    prisma.qcMeasurement.findMany({ where, select }),
  ]);
  return [...measurements, ...qcs].map((m) => ({
    sample_id: m.sampleId,
    aliquot: m.aliquot,
    record_type: m.recordType,
    polymer: m.polymer,
    polymer_raw: m.polymerRaw,
    method: m.method,
    matrix: m.matrix,
    matrix_detail: m.matrixDetail,
  }));
}

export async function suggestStagedMapping(
  ctx: LabContext,
  studyId: string,
  token: string,
  sheet?: string | null,
): Promise<Mapping> {
  assertRole(ctx, "researcher");
  await requireStudy(ctx, studyId);
  const staged = await readStaging(owner(ctx, studyId), token);
  return engineClient.suggestMapping(
    { data: new Uint8Array(staged.bytes), filename: staged.name },
    sheet,
  );
}

export type CheckInput = { token: string; sheet?: string | null; mapping: Mapping };

type Checked = {
  result: ImportResult;
  context: StudyContext;
  staged: Awaited<ReturnType<typeof readStaging>>;
  pii: boolean;
};

/** Contrôle d'un dépôt ; en cas de donnée personnelle, efface le dépôt et journalise les seuls comptes. */
async function runCheck(
  ctx: LabContext,
  studyId: string,
  input: CheckInput,
): Promise<Checked> {
  const context = await buildStudyContext(ctx, studyId);
  const staged = await readStaging(owner(ctx, studyId), input.token);
  const existing = await existingKeys(ctx, studyId);
  const result = await engineClient.checkImport({
    file: { data: new Uint8Array(staged.bytes), filename: staged.name },
    sheet: input.sheet,
    mapping: input.mapping,
    context,
    existing,
  });
  if (!result.issues.some((i) => PII_CODES.has(i.code))) {
    return { result, context, staged, pii: false };
  }
  await deleteStaging(input.token);
  const counts = { error: 0, warning: 0, info: 0 };
  const codes: Record<string, number> = {};
  for (const i of result.issues) {
    counts[i.severity] += 1;
    codes[i.code] = (codes[i.code] ?? 0) + 1;
  }
  await prisma.$transaction((tx) =>
    recordAudit(tx, {
      actorId: ctx.userId,
      action: "import.refused_pii",
      entityType: "Study",
      entityId: studyId,
      laboratoryId: ctx.laboratoryId,
      after: { counts, codes },
    }),
  );
  return {
    result: { ...result, records: [], qc_records: [] },
    context,
    staged,
    pii: true,
  };
}

export async function checkStagedImport(
  ctx: LabContext,
  studyId: string,
  input: CheckInput,
): Promise<ImportResult> {
  assertRole(ctx, "researcher");
  return (await runCheck(ctx, studyId, input)).result;
}

export type SaveInput = CheckInput & { acceptWarnings: boolean };

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function saveImport(
  ctx: LabContext,
  studyId: string,
  input: SaveInput,
): Promise<{ importRunId: string }> {
  assertRole(ctx, "researcher");
  const { result, context, staged, pii } = await runCheck(ctx, studyId, input);
  if (pii) throw new DomainError(PII_REFUSED);
  if (result.has_errors || result.counts.error > 0) {
    throw new DomainError(
      "Enregistrement impossible : le contrôle signale des erreurs.",
    );
  }
  const hasWarnings = result.counts.warning > 0;
  if (hasWarnings && !input.acceptWarnings) {
    throw new DomainError("Acceptez les avertissements pour enregistrer.");
  }
  const storagePath = await storeFile(staged.sha256, staged.bytes);

  let importRunId: string;
  try {
    importRunId = await prisma.$transaction(async (tx) => {
      await loadWritable(tx, ctx, studyId);
      const dataFile =
        (await tx.dataFile.findUnique({
          where: { studyId_sha256: { studyId, sha256: staged.sha256 } },
        })) ??
        (await tx.dataFile.create({
          data: {
            studyId,
            originalName: staged.name,
            sha256: staged.sha256,
            sizeBytes: staged.size,
            mimeType: staged.type,
            storagePath,
            uploadedById: ctx.userId,
          },
        }));
      const active = await tx.importRun.findFirst({
        where: { studyId, dataFileId: dataFile.id, status: "active" },
        select: { id: true },
      });
      if (active) throw new DomainError(DUPLICATE);

      const now = new Date();
      const accepted = hasWarnings && input.acceptWarnings;
      const run = await tx.importRun.create({
        data: {
          studyId,
          dataFileId: dataFile.id,
          sheet: result.sheet ?? input.sheet ?? null,
          mapping: input.mapping as unknown as Prisma.InputJsonValue,
          frozenContext: context as unknown as Prisma.InputJsonValue,
          rulesVersion: result.rules_version,
          engineVersion: result.engine_version,
          issues: result.issues as unknown as Prisma.InputJsonValue,
          errorCount: result.counts.error,
          warningCount: result.counts.warning,
          infoCount: result.counts.info,
          warningsAccepted: accepted,
          warningsAcceptedAt: accepted ? now : null,
          warningsAcceptedById: accepted ? ctx.userId : null,
          createdById: ctx.userId,
        },
      });
      await tx.measurement.createMany({
        data: result.records.map((r) => ({
          ...measurementRow(r),
          importRunId: run.id,
          studyId,
        })),
      });
      await tx.qcMeasurement.createMany({
        data: result.qc_records.map((r) => ({
          ...measurementRow(r),
          importRunId: run.id,
          studyId,
        })),
      });
      await recordAudit(tx, {
        actorId: ctx.userId,
        action: "import.create",
        entityType: "ImportRun",
        entityId: run.id,
        laboratoryId: ctx.laboratoryId,
        after: {
          fileName: dataFile.originalName,
          sha256: dataFile.sha256,
          rows: result.n_rows,
          errorCount: result.counts.error,
          warningCount: result.counts.warning,
          infoCount: result.counts.info,
        },
      });
      return run.id;
    }, SAVE_TX_OPTIONS);
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError(DUPLICATE);
    throw e;
  }
  await deleteStaging(input.token);
  return { importRunId };
}

export async function retireImport(
  ctx: LabContext,
  importRunId: string,
  reason: string,
): Promise<void> {
  assertRole(ctx, "researcher");
  const motif = reason.trim();
  await prisma.$transaction(async (tx) => {
    const run = await tx.importRun.findFirst({
      where: { id: importRunId, study: { laboratoryId: ctx.laboratoryId } },
      include: { dataFile: { select: { originalName: true } } },
    });
    if (!run) throw new DomainError("Import introuvable.");
    await loadWritable(tx, ctx, run.studyId);
    if (!motif) throw new DomainError("Le motif de retrait est obligatoire.");
    const now = new Date();
    const { count } = await tx.importRun.updateMany({
      where: {
        id: importRunId,
        status: "active",
        study: { laboratoryId: ctx.laboratoryId },
      },
      data: { status: "retired", retiredAt: now, retiredReason: motif },
    });
    if (count !== 1) throw new DomainError("Import déjà retiré.");
    const fileName = run.dataFile.originalName;
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "import.retire",
      entityType: "ImportRun",
      entityId: importRunId,
      laboratoryId: ctx.laboratoryId,
      before: { status: "active", fileName },
      after: { status: "retired", reason: motif, fileName },
    });
  });
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Imports de l'étude, du plus récent au plus ancien. */
export async function listImports(ctx: LabContext, studyId: string) {
  assertRole(ctx, "viewer");
  const runs = await prisma.importRun.findMany({
    where: { studyId, study: { laboratoryId: ctx.laboratoryId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      sheet: true,
      errorCount: true,
      warningCount: true,
      infoCount: true,
      warningsAccepted: true,
      retiredReason: true,
      retiredAt: true,
      rulesVersion: true,
      createdById: true,
      createdAt: true,
      dataFile: { select: { originalName: true, sizeBytes: true } },
      _count: { select: { measurements: true, qcMeasurements: true } },
    },
  });
  const names = await userNames(runs.map((r) => r.createdById));
  return runs.map(({ dataFile, _count, createdById, ...r }) => ({
    ...r,
    fileName: dataFile.originalName,
    sizeBytes: dataFile.sizeBytes,
    measurementCount: _count.measurements,
    qcMeasurementCount: _count.qcMeasurements,
    createdByName: names.get(createdById) ?? null,
  }));
}

/** Un import avec ses issues ; null s'il n'existe pas dans le laboratoire. */
export async function getImport(ctx: LabContext, importRunId: string) {
  assertRole(ctx, "viewer");
  const run = await prisma.importRun.findFirst({
    where: { id: importRunId, study: { laboratoryId: ctx.laboratoryId } },
    include: {
      dataFile: { select: { originalName: true, sizeBytes: true, sha256: true } },
      _count: { select: { measurements: true, qcMeasurements: true } },
    },
  });
  if (!run) return null;
  const names = await userNames([run.createdById]);
  const { dataFile, _count, ...rest } = run;
  return {
    ...rest,
    fileName: dataFile.originalName,
    sizeBytes: dataFile.sizeBytes,
    sha256: dataFile.sha256,
    measurementCount: _count.measurements,
    qcMeasurementCount: _count.qcMeasurements,
    createdByName: names.get(run.createdById) ?? null,
  };
}
