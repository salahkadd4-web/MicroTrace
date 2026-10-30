import "server-only";
import { prisma } from "@/server/db";
import {
  engineClient,
  type ImportResult,
  type StudyContext,
  type SummaryResponse,
} from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { measurementRecord } from "@/server/imports";
import type { LabContext } from "@/server/lab-context";
import { assertRole } from "@/server/lab-role";
import { buildStudyContext } from "@/server/studies";

type MeasurementRecord = ImportResult["records"][number];

export type ResultsImport = {
  id: string;
  fileName: string;
  sha256: string;
  rulesVersion: string;
  createdAt: Date;
  author: string | null;
  frozenContext: StudyContext;
};

/** Tout ce que l'écran, le rapport et l'export CSV lisent pour une étude (imports actifs seulement). */
export type ActiveResultsInput = {
  study: { id: string; title: string; nature: string; archivedAt: Date | null };
  imports: ResultsImport[];
  records: MeasurementRecord[];
  qcRecords: MeasurementRecord[];
  mixedRulesVersions: boolean;
  contextChanged: boolean;
  /** Contexte figé à utiliser : le commun s'il est unique, sinon celui de l'import le plus récent. */
  context: StudyContext;
};

/** Forme canonique (clés triées) : comparaison structurelle indépendante de l'ordre des clés. */
function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, walk(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(walk(JSON.parse(JSON.stringify(value ?? null))));
}

const ORDER = [
  { importRun: { createdAt: "asc" } },
  { importRunId: "asc" },
  { sourceRow: "asc" },
  { sourceColumn: "asc" },
] as const;

/**
 * Charge les mesures et contrôles qualité des imports `active` d'une étude du laboratoire,
 * triés par import (date), ligne puis colonne source : ordre reproductible pour l'écran,
 * le rapport et le CSV. Une étude archivée reste lisible. Rôle viewer minimum.
 */
export async function loadActiveResultsInput(
  ctx: LabContext,
  studyId: string,
): Promise<ActiveResultsInput> {
  assertRole(ctx, "viewer");
  const study = await prisma.study.findFirst({
    where: { id: studyId, laboratoryId: ctx.laboratoryId },
    select: { id: true, title: true, nature: true, archivedAt: true },
  });
  if (!study) throw new DomainError("Étude introuvable.");

  const runs = await prisma.importRun.findMany({
    where: { studyId, status: "active", study: { laboratoryId: ctx.laboratoryId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      rulesVersion: true,
      createdAt: true,
      createdById: true,
      frozenContext: true,
      dataFile: { select: { originalName: true, sha256: true } },
    },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(runs.map((r) => r.createdById))] } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const imports: ResultsImport[] = runs.map((r) => ({
    id: r.id,
    fileName: r.dataFile.originalName,
    sha256: r.dataFile.sha256,
    rulesVersion: r.rulesVersion,
    createdAt: r.createdAt,
    author: names.get(r.createdById) ?? null,
    frozenContext: r.frozenContext as unknown as StudyContext,
  }));

  const where = {
    studyId,
    study: { laboratoryId: ctx.laboratoryId },
    importRun: { status: "active" as const },
  };
  const [rows, qcRows, current] = await Promise.all([
    prisma.measurement.findMany({ where, orderBy: [...ORDER] }),
    prisma.qcMeasurement.findMany({ where, orderBy: [...ORDER] }),
    buildStudyContext(ctx, studyId),
  ]);

  const forms = new Set(imports.map((i) => canonical(i.frozenContext)));
  const importsDiffer = forms.size > 1;
  const context =
    imports.length === 0
      ? current
      : importsDiffer
        ? imports[imports.length - 1].frozenContext
        : imports[0].frozenContext;
  const contextChanged =
    imports.length > 0 && (importsDiffer || !forms.has(canonical(current)));

  return {
    study,
    imports,
    records: rows.map((r) => measurementRecord(r)),
    qcRecords: qcRows.map((r) => measurementRecord(r)),
    mixedRulesVersions: new Set(imports.map((i) => i.rulesVersion)).size > 1,
    contextChanged,
    context,
  };
}

export type StudyResults =
  | { empty: true }
  | {
      empty: false;
      summary: SummaryResponse;
      imports: Omit<ResultsImport, "frozenContext">[];
      mixedRulesVersions: boolean;
      contextChanged: boolean;
      nature: string;
    };

/** Résultats calculés à la demande par le moteur sur les mesures des imports actifs. */
export async function getStudyResults(
  ctx: LabContext,
  studyId: string,
): Promise<StudyResults> {
  const input = await loadActiveResultsInput(ctx, studyId);
  if (input.records.length === 0) return { empty: true };
  const summary = await engineClient.summary({ records: input.records });
  return {
    empty: false,
    summary,
    imports: input.imports.map(({ frozenContext: _ctx, ...rest }) => {
      void _ctx;
      return rest;
    }),
    mixedRulesVersions: input.mixedRulesVersions,
    contextChanged: input.contextChanged,
    nature: input.study.nature,
  };
}
