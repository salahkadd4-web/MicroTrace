import "server-only";
import {
  CONSENT_ALREADY_GIVEN,
  CONSENT_NOT_GIVEN,
  EXPORT_COLUMNS,
  EXPORT_FORMAT,
  EXPORT_NOTICE,
  EXPORT_PREREQUISITES,
  EXPORT_TOO_LARGE,
  NO_CONSENT_EXPORT,
  TRAINING_CONSENT_VERSION,
} from "@/lib/training-consent";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { readStoredFile } from "@/server/file-store";
import type { LabContext } from "@/server/lab-context";
import { assertRole } from "@/server/lab-role";
import { csvCell, parisDay } from "@/server/report-files";
import type { DownloadFile } from "@/server/report-download";
import { lockLaboratory } from "@/server/tx-lock";

/** Au plus ce nombre de lignes par export (les plus récentes). */
const MAX_ROWS = 1000;
/** Total des fichiers joints (octets bruts) au-delà duquel l'export est refusé. */
const MAX_FILES_BYTES = 50 * 1024 * 1024;
const HISTORY_LIMIT = 20;
const CONSENT_ACTIONS = [
  "lab.training_consent.grant",
  "lab.training_consent.revoke",
  "lab.training_export",
];

export type TrainingConsentView = {
  granted: boolean;
  grantedAt: Date | null;
  grantedBy: string | null;
  version: string | null;
  /** Vide sauf pour un responsable du laboratoire. */
  history: { id: string; at: Date; action: string; by: string | null }[];
};

type ConsentState = { name: string; granted: boolean; at: string | null; version: string | null };

const stateOf = (lab: {
  name: string;
  trainingConsentAt: Date | null;
  trainingConsentVersion: string | null;
}): ConsentState => ({
  name: lab.name,
  granted: lab.trainingConsentAt !== null,
  at: lab.trainingConsentAt?.toISOString() ?? null,
  version: lab.trainingConsentVersion,
});

async function namesOf(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** État du consentement du laboratoire (tout membre) ; l'historique n'est lu que par un responsable. */
export async function getTrainingConsent(ctx: LabContext): Promise<TrainingConsentView> {
  const lab = await prisma.laboratory.findUnique({
    where: { id: ctx.laboratoryId },
    select: { trainingConsentAt: true, trainingConsentById: true, trainingConsentVersion: true },
  });
  const events =
    ctx.role === "lab_admin"
      ? await prisma.auditEvent.findMany({
          where: { laboratoryId: ctx.laboratoryId, action: { in: CONSENT_ACTIONS } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: HISTORY_LIMIT,
          select: { id: true, createdAt: true, action: true, actorId: true },
        })
      : [];
  const names = await namesOf([lab?.trainingConsentById ?? null, ...events.map((e) => e.actorId)]);
  return {
    granted: !!lab?.trainingConsentAt,
    grantedAt: lab?.trainingConsentAt ?? null,
    grantedBy: lab?.trainingConsentById ? (names.get(lab.trainingConsentById) ?? null) : null,
    version: lab?.trainingConsentVersion ?? null,
    history: events.map((e) => ({
      id: e.id,
      at: e.createdAt,
      action: e.action,
      by: e.actorId ? (names.get(e.actorId) ?? null) : null,
    })),
  };
}

/** Donne ou retire le consentement du laboratoire (responsable) : daté, attribué, audité. */
export async function setTrainingConsent(ctx: LabContext, granted: boolean): Promise<void> {
  assertRole(ctx, "lab_admin");
  await prisma.$transaction(async (tx) => {
    await lockLaboratory(tx, ctx.laboratoryId);
    const lab = await tx.laboratory.findUnique({
      where: { id: ctx.laboratoryId },
      select: { name: true, trainingConsentAt: true, trainingConsentVersion: true },
    });
    if (!lab) throw new DomainError("Laboratoire introuvable.");
    const current = lab.trainingConsentAt !== null;
    if (granted && current) throw new DomainError(CONSENT_ALREADY_GIVEN);
    if (!granted && !current) throw new DomainError(CONSENT_NOT_GIVEN);
    const next = granted
      ? {
          trainingConsentAt: new Date(),
          trainingConsentById: ctx.userId,
          trainingConsentVersion: TRAINING_CONSENT_VERSION,
        }
      : { trainingConsentAt: null, trainingConsentById: null, trainingConsentVersion: null };
    const updated = await tx.laboratory.update({
      where: { id: ctx.laboratoryId },
      data: next,
      select: { name: true, trainingConsentAt: true, trainingConsentVersion: true },
    });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: granted ? "lab.training_consent.grant" : "lab.training_consent.revoke",
      entityType: "Laboratory",
      entityId: ctx.laboratoryId,
      laboratoryId: ctx.laboratoryId,
      before: stateOf(lab),
      after: stateOf(updated),
    });
  });
}

type Stored = Record<string, unknown>;
const rec = (v: unknown): Stored =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Stored) : {};
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string | number | null>;

/**
 * Lignes d'export : la dernière décision de chaque analyse spectrale des études du laboratoire, si elle
 * est acceptée ou corrigée, les plus récentes d'abord. Rien d'une autre étude ni d'un autre laboratoire.
 */
async function consentedRows(ctx: LabContext): Promise<ExportRow[]> {
  const decisions = await prisma.modelPrediction.findMany({
    where: {
      kind: "spectral",
      status: { not: "proposed" },
      study: { laboratoryId: ctx.laboratoryId },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      input: true,
      output: true,
      decidedAt: true,
      createdAt: true,
      studyId: true,
    },
  });
  const latest = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) {
    const analysisId = text(rec(d.input).analysisId);
    if (analysisId !== null && !latest.has(analysisId)) latest.set(analysisId, d);
  }
  const kept = [...latest.entries()]
    .filter(([, d]) => d.status === "accepted" || d.status === "corrected")
    .sort(
      ([, a], [, b]) =>
        (b.decidedAt ?? b.createdAt).getTime() - (a.decidedAt ?? a.createdAt).getTime() ||
        (a.id < b.id ? 1 : -1),
    )
    .slice(0, MAX_ROWS);
  if (kept.length === 0) return [];
  const analyses = await prisma.modelPrediction.findMany({
    where: {
      id: { in: kept.map(([id]) => id) },
      kind: "spectral",
      status: "proposed",
      study: { laboratoryId: ctx.laboratoryId },
    },
    include: { study: { select: { nature: true } } },
  });
  const byId = new Map(analyses.map((a) => [a.id, a]));
  const rows: ExportRow[] = [];
  for (const [analysisId, d] of kept) {
    const a = byId.get(analysisId);
    if (!a || a.studyId !== d.studyId) continue;
    const ai = rec(a.input);
    const di = rec(d.input);
    const dout = rec(d.output);
    rows.push({
      analysis_id: a.id,
      decision_id: d.id,
      study_id: a.studyId,
      study_nature: a.study.nature,
      decided_at: (d.decidedAt ?? d.createdAt).toISOString(),
      decision: d.status,
      label: text(di.polymer),
      proposed_polymer: text(dout.proposedPolymer),
      proposed_status: text(dout.proposedStatus),
      score: a.score,
      technique: text(ai.technique),
      x_unit: text(ai.xUnit),
      y_unit: text(ai.yUnit),
      laser_nm: num(ai.laserNm),
      file_sha256: a.inputFileSha256,
      file_size: num(ai.sizeBytes),
      model_name: a.modelName,
      model_version: a.modelVersion,
      model_sha256: a.modelSha256,
    });
  }
  return rows;
}

/**
 * Export des décisions spectrales consenties du laboratoire (responsable). Préparation seulement : aucun
 * entraînement n'est lancé ici. Le consentement est relu en base ; refusé, rien n'est audité.
 */
export async function buildTrainingExport(
  ctx: LabContext,
  format: "json" | "csv",
): Promise<DownloadFile> {
  assertRole(ctx, "lab_admin");
  const lab = await prisma.laboratory.findUnique({
    where: { id: ctx.laboratoryId },
    select: { slug: true, name: true, trainingConsentAt: true, trainingConsentVersion: true },
  });
  if (!lab || !lab.trainingConsentAt || !lab.trainingConsentVersion) {
    throw new DomainError(NO_CONSENT_EXPORT);
  }
  const rows = await consentedRows(ctx);
  const generatedAt = new Date();
  const fileName = `microtrace-${lab.slug}-entrainement-spectral-${parisDay(generatedAt)}.${format}`;

  let body: string;
  if (format === "json") {
    let total = 0;
    const withFiles: Record<string, unknown>[] = [];
    for (const row of rows) {
      let bytes: Buffer | null = null;
      try {
        bytes = row.file_sha256 ? await readStoredFile(String(row.file_sha256)) : null;
      } catch {
        bytes = null; // fichier du magasin altéré : jamais exporté
      }
      if (bytes) {
        total += bytes.length;
        if (total > MAX_FILES_BYTES) throw new DomainError(EXPORT_TOO_LARGE);
      }
      withFiles.push(
        bytes
          ? { ...row, file_base64: bytes.toString("base64") }
          : { ...row, file_base64: null, file_missing: true },
      );
    }
    body = JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      exported_at: generatedAt.toISOString(),
      laboratory: { slug: lab.slug, name: lab.name },
      consent: { granted_at: lab.trainingConsentAt.toISOString(), version: lab.trainingConsentVersion },
      notice: EXPORT_NOTICE,
      prerequisites: EXPORT_PREREQUISITES,
      rows: withFiles,
    });
  } else {
    const lines = [EXPORT_COLUMNS, ...rows.map((r) => EXPORT_COLUMNS.map((c) => r[c]))].map((r) =>
      r.map((v) => csvCell(v as string | number | null)).join(","),
    );
    body = `${lines.join("\r\n")}\r\n`;
  }

  await prisma.$transaction((tx) =>
    recordAudit(tx, {
      actorId: ctx.userId,
      action: "lab.training_export",
      entityType: "Laboratory",
      entityId: ctx.laboratoryId,
      laboratoryId: ctx.laboratoryId,
      after: { format, rows: rows.length, consentVersion: lab.trainingConsentVersion },
    }),
  );
  return {
    body,
    contentType: format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
    fileName,
  };
}
