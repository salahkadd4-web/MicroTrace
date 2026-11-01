import "server-only";
import { createHash } from "node:crypto";
import {
  CONSENT_ALREADY_GIVEN,
  CONSENT_RENEW,
  CONSENT_NOT_GIVEN,
  EXPORT_COLUMNS,
  EXPORT_FORMAT,
  EXPORT_NOTICE,
  EXPORT_PREREQUISITES,
  IMAGE_EXPORT_COLUMNS,
  IMAGE_EXPORT_FORMAT,
  EXPORT_TOO_LARGE,
  NO_CONSENT_EXPORT,
  TRAINING_CONSENT_VERSION,
} from "@/lib/training-consent";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { EngineError, engineClient } from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { readStoredFile } from "@/server/file-store";
import type { LabContext } from "@/server/lab-context";
import { assertRole } from "@/server/lab-role";
import { csvCell, parisDay } from "@/server/report-files";
import type { DownloadFile } from "@/server/report-download";
import { lockLaboratory } from "@/server/tx-lock";

/** Au plus ce nombre de lignes par export (les plus récentes). */
const MAX_ROWS = 1000;
/** Total des fichiers lus (octets bruts, jamais exportés tels quels) au-delà duquel l'export est refusé. */
const MAX_FILES_BYTES = 50 * 1024 * 1024;
/** Appels simultanés au moteur pour lire les spectres. */
const PARSE_BATCH = 8;
/** Analyses d'images relues par requête. */
const ANALYSIS_BATCH = 200;
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
  history: {
    id: string;
    at: Date;
    action: string;
    by: string | null;
    kind?: "spectral" | "image" | null;
  }[];
};

type ConsentState = {
  name: string;
  granted: boolean;
  at: string | null;
  version: string | null;
};

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
export async function getTrainingConsent(
  ctx: LabContext,
): Promise<TrainingConsentView> {
  const lab = await prisma.laboratory.findUnique({
    where: { id: ctx.laboratoryId },
    select: {
      trainingConsentAt: true,
      trainingConsentById: true,
      trainingConsentVersion: true,
    },
  });
  const events =
    ctx.role === "lab_admin"
      ? await prisma.auditEvent.findMany({
          where: {
            laboratoryId: ctx.laboratoryId,
            action: { in: CONSENT_ACTIONS },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: HISTORY_LIMIT,
          select: {
            id: true,
            createdAt: true,
            action: true,
            actorId: true,
            after: true,
          },
        })
      : [];
  const names = await namesOf([
    lab?.trainingConsentById ?? null,
    ...events.map((e) => e.actorId),
  ]);
  return {
    granted: !!lab?.trainingConsentAt,
    grantedAt: lab?.trainingConsentAt ?? null,
    grantedBy: lab?.trainingConsentById
      ? (names.get(lab.trainingConsentById) ?? null)
      : null,
    version: lab?.trainingConsentVersion ?? null,
    history: events.map((e) => ({
      id: e.id,
      at: e.createdAt,
      action: e.action,
      by: e.actorId ? (names.get(e.actorId) ?? null) : null,
      kind:
        e.action === "lab.training_export"
          ? rec(e.after).kind === "image"
            ? "image"
            : "spectral"
          : null,
    })),
  };
}

/** Donne ou retire le consentement du laboratoire (responsable) : daté, attribué, audité. */
export async function setTrainingConsent(
  ctx: LabContext,
  granted: boolean,
): Promise<void> {
  assertRole(ctx, "lab_admin");
  await prisma.$transaction(async (tx) => {
    await lockLaboratory(tx, ctx.laboratoryId);
    const lab = await tx.laboratory.findUnique({
      where: { id: ctx.laboratoryId },
      select: {
        name: true,
        trainingConsentAt: true,
        trainingConsentVersion: true,
      },
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
      : {
          trainingConsentAt: null,
          trainingConsentById: null,
          trainingConsentVersion: null,
        };
    const updated = await tx.laboratory.update({
      where: { id: ctx.laboratoryId },
      data: next,
      select: {
        name: true,
        trainingConsentAt: true,
        trainingConsentVersion: true,
      },
    });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: granted
        ? "lab.training_consent.grant"
        : "lab.training_consent.revoke",
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

/**
 * Études exportables : celles du laboratoire, ni simulées (données fictives) ni sans pseudonymisation
 * déclarée (les fichiers déposés peuvent porter des données personnelles).
 */
const ELIGIBLE_STUDY = (ctx: LabContext) => ({
  laboratoryId: ctx.laboratoryId,
  nature: { not: "simulated" as const },
  pseudonymDeclaredAt: { not: null },
});

type ExportRow = Record<
  (typeof EXPORT_COLUMNS)[number],
  string | number | null
>;

/**
 * Lignes d'export : la dernière décision de chaque analyse spectrale des études du laboratoire, si elle
 * est acceptée ou corrigée, les plus récentes d'abord. Rien d'une autre étude ni d'un autre laboratoire.
 */
async function latestAccepted(ctx: LabContext, kind: "spectral" | "image") {
  const decisions = await prisma.modelPrediction.findMany({
    where: {
      kind,
      status: { not: "proposed" },
      study: ELIGIBLE_STUDY(ctx),
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
    if (analysisId !== null && !latest.has(analysisId))
      latest.set(analysisId, d);
  }
  const accepted = [...latest.entries()]
    .filter(([, d]) => d.status === "accepted" || d.status === "corrected")
    .sort(
      ([, a], [, b]) =>
        (b.decidedAt ?? b.createdAt).getTime() -
          (a.decidedAt ?? a.createdAt).getTime() || (a.id < b.id ? 1 : -1),
    );
  return accepted;
}

async function consentedRows(
  ctx: LabContext,
): Promise<{ rows: ExportRow[]; total: number }> {
  const accepted = await latestAccepted(ctx, "spectral");
  const kept = accepted.slice(0, MAX_ROWS);
  if (kept.length === 0) return { rows: [], total: 0 };
  const analyses = await prisma.modelPrediction.findMany({
    where: {
      id: { in: kept.map(([id]) => id) },
      kind: "spectral",
      status: "proposed",
      study: ELIGIBLE_STUDY(ctx),
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
  return { rows, total: accepted.length };
}

type ImageExportRow = Record<
  (typeof IMAGE_EXPORT_COLUMNS)[number],
  string | number | null
>;
type ImageParticleExport = {
  id: number;
  contour: number[][] | null;
  contour_invalid?: true;
  proposed_shape: string;
  validated_shape: string | null;
  excluded: boolean;
};
type ImageRowSet = {
  row: ImageExportRow;
  displaySha256: string | null;
  particles: ImageParticleExport[];
};

/** Contour valide : au moins 3 points [x, y] finis ; sinon null (signalé dans la ligne). */
function validContour(v: unknown): number[][] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const out: number[][] = [];
  for (const pt of v) {
    if (!Array.isArray(pt) || pt.length !== 2) return null;
    if (!pt.every((n) => typeof n === "number" && Number.isFinite(n)))
      return null;
    out.push([pt[0] as number, pt[1] as number]);
  }
  return out;
}

const numbersOf = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];

/**
 * Lignes d'export des images : la dernière décision acceptée ou corrigée de chaque analyse, hors études
 * simulées ou sans pseudonymisation, et hors analyses dont l'état proposé était « non fiable » (quelle
 * que soit la décision humaine). Ni nom de fichier, ni note, ni titre, ni métadonnée.
 */
async function consentedImageRows(
  ctx: LabContext,
): Promise<{ rows: ImageRowSet[]; total: number }> {
  const accepted = (await latestAccepted(ctx, "image")).filter(
    ([, d]) => text(rec(d.output).proposedStatus) !== "unreliable",
  );
  const rows: ImageRowSet[] = [];
  // `total` ne compte que les analyses réellement exportables (relues par paquets).
  let total = 0;
  for (let from = 0; from < accepted.length; from += ANALYSIS_BATCH) {
    const chunk = accepted.slice(from, from + ANALYSIS_BATCH);
    const analyses = await prisma.modelPrediction.findMany({
      where: {
        id: { in: chunk.map(([id]) => id) },
        kind: "image",
        status: "proposed",
        study: ELIGIBLE_STUDY(ctx),
      },
      include: { study: { select: { nature: true } } },
    });
    const byId = new Map(analyses.map((a) => [a.id, a]));
    for (const [analysisId, d] of chunk) {
      const a = byId.get(analysisId);
      if (!a || a.studyId !== d.studyId) continue;
      const ao = rec(a.output);
      if (text(ao.status) === "unreliable") continue;
      total += 1;
      if (rows.length >= MAX_ROWS) continue;
      const ai = rec(a.input);
      const di = rec(d.input);
      const validated = rec(rec(d.output).validated);
      const scale = rec(ao.scale);
      const aInput = rec(ao.input);
      const excluded = new Set(numbersOf(di.excluded));
      const reshaped = new Map<number, string>();
      if (Array.isArray(di.reshaped)) {
        for (const r of di.reshaped) {
          const { id, shape } = rec(r);
          if (typeof id === "number" && typeof shape === "string")
            reshaped.set(id, shape);
        }
      }
      const particles: ImageParticleExport[] = [];
      if (Array.isArray(ao.particles)) {
        for (const raw of ao.particles) {
          const p = rec(raw);
          const id = num(p.id);
          if (id === null) continue;
          const shape = text(p.shape) ?? "unspecified";
          const contour = validContour(p.contour);
          particles.push({
            id,
            contour,
            ...(contour === null ? { contour_invalid: true as const } : {}),
            proposed_shape: shape,
            validated_shape: excluded.has(id)
              ? null
              : (reshaped.get(id) ?? shape),
            excluded: excluded.has(id),
          });
        }
      }
      const displaySha256 = text(ai.displaySha256);
      rows.push({
        displaySha256,
        particles,
        row: {
          analysis_id: a.id,
          decision_id: d.id,
          study_id: a.studyId,
          study_nature: a.study.nature,
          decided_at: (d.decidedAt ?? d.createdAt).toISOString(),
          decision: d.status,
          // Empreinte de l'image réécrite par MicroTrace (celle qui est exportée), jamais du fichier déposé.
          image_sha256: displaySha256,
          analysis_width: num(aInput.analysis_width),
          analysis_height: num(aInput.analysis_height),
          scale_um_per_px: num(scale.um_per_px_analysis),
          scale_source: text(scale.source) ?? "none",
          proposed_count: num(ao.count),
          validated_count: num(validated.count),
          missed_count: num(di.missedCount) ?? num(validated.missed),
          model_name: a.modelName,
          model_version: a.modelVersion,
          model_sha256: a.modelSha256,
        },
      });
    }
  }
  return { rows, total };
}

/** Lit l'image d'analyse du magasin (empreinte revérifiée) : absente ou corrompue sont signalées, non fatales. */
async function readDisplay(
  sha: string | null,
): Promise<{ bytes: Buffer | null; corrupt: boolean }> {
  // Empreinte absente ou mal formée (valeur écrite par le serveur, mais jamais de plantage) : fichier absent.
  if (!sha || !/^[0-9a-f]{64}$/.test(sha))
    return { bytes: null, corrupt: false };
  try {
    return { bytes: await readStoredFile(sha), corrupt: false };
  } catch (e) {
    if (e instanceof Error && e.message === "Fichier du magasin corrompu.") {
      return { bytes: null, corrupt: true };
    }
    throw e;
  }
}

/**
 * Export des décisions consenties du laboratoire (responsable), spectrales ou d'images. Préparation
 * seulement : aucun entraînement n'est lancé ici. Le consentement est relu en base ; refusé, rien n'est
 * audité.
 */
export async function buildTrainingExport(
  ctx: LabContext,
  format: "json" | "csv",
  kind: "spectral" | "image" = "spectral",
  opts: { maxFilesBytes?: number } = {},
): Promise<DownloadFile> {
  assertRole(ctx, "lab_admin");
  const lab = await prisma.laboratory.findUnique({
    where: { id: ctx.laboratoryId },
    select: {
      slug: true,
      name: true,
      trainingConsentAt: true,
      trainingConsentVersion: true,
    },
  });
  if (!lab || !lab.trainingConsentAt || !lab.trainingConsentVersion) {
    throw new DomainError(NO_CONSENT_EXPORT);
  }
  if (lab.trainingConsentVersion !== TRAINING_CONSENT_VERSION)
    throw new DomainError(CONSENT_RENEW);
  const consentAt = lab.trainingConsentAt;
  const consentVersion = lab.trainingConsentVersion;
  const generatedAt = new Date();
  const maxBytes = opts.maxFilesBytes ?? MAX_FILES_BYTES;
  const header = {
    exported_at: generatedAt.toISOString(),
    laboratory: { slug: lab.slug, name: lab.name },
    consent: { granted_at: consentAt.toISOString(), version: consentVersion },
    notice: EXPORT_NOTICE,
    prerequisites: EXPORT_PREREQUISITES,
  };

  let body: string;
  let rowCount: number;
  let truncated: boolean;
  let fileName: string;
  if (kind === "image") {
    const { rows, total } = await consentedImageRows(ctx);
    rowCount = rows.length;
    truncated = total > rows.length;
    fileName = `microtrace-${lab.slug}-entrainement-images-${parisDay(generatedAt)}.${format}`;
    if (format === "json") {
      let totalBytes = 0;
      const out: Record<string, unknown>[] = [];
      for (const r of rows) {
        const f = await readDisplay(r.displaySha256);
        const png = f.bytes ? f.bytes.toString("base64") : null;
        // Le budget compte ce qui est écrit : image en base64 et contours.
        totalBytes += (png?.length ?? 0) + JSON.stringify(r.particles).length;
        if (totalBytes > maxBytes) throw new DomainError(EXPORT_TOO_LARGE);
        out.push({
          ...r.row,
          display_png_base64: png,
          ...(f.bytes
            ? {}
            : f.corrupt
              ? { file_corrupt: true }
              : { file_missing: true }),
          particles: r.particles,
        });
      }
      body = JSON.stringify({
        format: IMAGE_EXPORT_FORMAT,
        version: 1,
        ...header,
        total_rows: total,
        truncated,
        rows: out,
      });
    } else {
      const lines = [
        IMAGE_EXPORT_COLUMNS,
        ...rows.map((r) => IMAGE_EXPORT_COLUMNS.map((c) => r.row[c])),
      ].map((r) =>
        r.map((v) => csvCell(v as string | number | null, ",")).join(","),
      );
      body = `${lines.join("\r\n")}\r\n`;
    }
  } else {
    const { rows, total } = await consentedRows(ctx);
    rowCount = rows.length;
    truncated = total > rows.length;
    fileName = `microtrace-${lab.slug}-entrainement-spectral-${parisDay(generatedAt)}.${format}`;
    body = await spectralBody(rows, total, truncated, format, header, maxBytes);
  }

  await auditExport(ctx, {
    format,
    rowCount,
    consentAt,
    consentVersion,
    kind,
    truncated,
    body,
  });
  return {
    body,
    contentType:
      format === "json"
        ? "application/json; charset=utf-8"
        : "text/csv; charset=utf-8",
    fileName,
  };
}

type ExportHeader = {
  exported_at: string;
  laboratory: { slug: string; name: string };
  consent: { granted_at: string; version: string };
  notice: string;
  prerequisites: string;
};

async function spectralBody(
  rows: ExportRow[],
  total: number,
  truncated: boolean,
  format: "json" | "csv",
  header: ExportHeader,
  maxBytes: number,
): Promise<string> {
  let body: string;
  if (format === "json") {
    let totalBytes = 0;
    const withSpectra: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += PARSE_BATCH) {
      const batch = rows.slice(i, i + PARSE_BATCH);
      // Lecture des fichiers (octets vérifiés) puis, par le moteur, des seules colonnes numériques.
      const files = await Promise.all(
        batch.map(async (row) => {
          try {
            return {
              bytes: row.file_sha256
                ? await readStoredFile(String(row.file_sha256))
                : null,
              corrupt: false,
            };
          } catch (e) {
            if (
              e instanceof Error &&
              e.message === "Fichier du magasin corrompu."
            ) {
              return { bytes: null, corrupt: true };
            }
            throw e;
          }
        }),
      );
      for (const f of files) {
        totalBytes += f.bytes?.length ?? 0;
        if (totalBytes > maxBytes) throw new DomainError(EXPORT_TOO_LARGE);
      }
      const parsed = await Promise.all(
        files.map(async (f) => {
          if (!f.bytes) return null;
          try {
            return await engineClient.parseSpectrum({
              data: new Uint8Array(f.bytes),
              filename: "spectre",
            });
          } catch (e) {
            if (
              e instanceof EngineError &&
              (e.status === 422 || e.status === 413)
            ) {
              return "unreadable" as const;
            }
            throw e;
          }
        }),
      );
      batch.forEach((row, j) => {
        const f = files[j];
        const p = parsed[j];
        if (p && p !== "unreadable") {
          withSpectra.push({ ...row, spectrum: { x: p.x, y: p.y } });
        } else if (p === "unreadable") {
          withSpectra.push({
            ...row,
            spectrum: null,
            spectrum_unreadable: true,
          });
        } else if (f.corrupt) {
          withSpectra.push({ ...row, spectrum: null, file_corrupt: true });
        } else {
          withSpectra.push({ ...row, spectrum: null, file_missing: true });
        }
      });
    }
    body = JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      ...header,
      total_rows: total,
      truncated,
      rows: withSpectra,
    });
  } else {
    const lines = [
      EXPORT_COLUMNS,
      ...rows.map((r) => EXPORT_COLUMNS.map((c) => r[c])),
    ].map((r) =>
      r.map((v) => csvCell(v as string | number | null, ",")).join(","),
    );
    body = `${lines.join("\r\n")}\r\n`;
  }
  return body;
}

/**
 * L'audit est écrit sous le verrou du laboratoire, après relecture du consentement : un retrait
 * validé pendant la construction du fichier l'emporte (ni fichier, ni événement d'export).
 */
async function auditExport(
  ctx: LabContext,
  a: {
    format: "json" | "csv";
    rowCount: number;
    consentAt: Date;
    consentVersion: string;
    kind: "spectral" | "image";
    truncated: boolean;
    body: string;
  },
): Promise<void> {
  const { consentAt, consentVersion } = a;
  await prisma.$transaction(async (tx) => {
    await lockLaboratory(tx, ctx.laboratoryId);
    const now = await tx.laboratory.findUnique({
      where: { id: ctx.laboratoryId },
      select: { trainingConsentAt: true, trainingConsentVersion: true },
    });
    if (
      !now?.trainingConsentAt ||
      now.trainingConsentAt.getTime() !== consentAt.getTime() ||
      now.trainingConsentVersion !== consentVersion
    ) {
      throw new DomainError(NO_CONSENT_EXPORT);
    }
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "lab.training_export",
      entityType: "Laboratory",
      entityId: ctx.laboratoryId,
      laboratoryId: ctx.laboratoryId,
      after: {
        format: a.format,
        rows: a.rowCount,
        consentVersion,
        ...(a.kind === "image" ? { kind: a.kind } : {}),
        truncated: a.truncated,
        bodySha256: createHash("sha256").update(a.body, "utf8").digest("hex"),
      },
    });
  });
}
