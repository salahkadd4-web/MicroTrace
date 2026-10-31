import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { SPECTRAL_MODEL_UNAVAILABLE, SPECTRAL_REFUSED } from "@/lib/engine-messages";
import { NOTE_MAX_LENGTH } from "@/lib/quality";
import {
  NOTE_REQUIRED_POLYMERS,
  SPECTRAL_DECISIONS,
  SPECTRAL_MAX_BYTES,
  TECHNIQUE_OPTIONS,
  X_UNIT_OPTIONS,
  Y_UNIT_OPTIONS,
  type SpectralDecision,
} from "@/lib/spectral";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import {
  EngineError,
  EngineUnavailableError,
  engineClient,
  type SpectralIdentifyResponse,
  type SpectralModelInfo,
} from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { storeFile } from "@/server/file-store";
import type { LabContext } from "@/server/lab-context";
import { assertRole } from "@/server/lab-role";
import { assertWritable, loadWritable } from "@/server/studies";
import { lockWritableStudy } from "@/server/study-lock";

/** Au plus ce nombre d'analyses est lu par étude (le reste est compté dans `hidden`). */
const MAX_ANALYSES = 500;
/** Au plus ce nombre de décisions est lu par étude (reporté au suivi : pagination). */
const MAX_DECISIONS = 5000;
const LASER_PATTERN = /^\d{1,4}(?:[.,]\d{1,3})?$/;

export type SpectralModelState =
  | { kind: "ok" | "unavailable"; info: SpectralModelInfo }
  | { kind: "engine_down" };

export type SpectralDecisionView = {
  id: string;
  decision: SpectralDecision;
  polymer: string | null;
  polymerLabel: string | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: Date;
  /** Nombre de décisions enregistrées sur l'analyse (la plus récente fait foi). */
  count: number;
};

export type SpectralAnalysisRow = {
  id: string;
  createdAt: Date;
  fileName: string;
  techniqueLabel: string;
  status: string;
  statusLabel: string;
  proposedLabel: string | null;
  modelVersion: string;
  decision: SpectralDecisionView | null;
};

export type SpectralAnalysisView = SpectralAnalysisRow & {
  createdBy: string | null;
  sizeBytes: number;
  inputSha256: string;
  technique: string;
  xUnit: string;
  yUnit: string;
  laserNm: number | null;
  modelName: string;
  modelSha256: string | null;
  output: SpectralIdentifyResponse;
  archived: boolean;
};

export type AnalyzeInput = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
  technique: string;
  xUnit: string;
  yUnit: string;
  laserNm: string | null;
};

type StoredInput = {
  role?: unknown;
  fileName?: unknown;
  sizeBytes?: unknown;
  technique?: unknown;
  xUnit?: unknown;
  yUnit?: unknown;
  laserNm?: unknown;
  analysisId?: unknown;
  decision?: unknown;
  polymer?: unknown;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isDecision = (v: unknown): v is SpectralDecision =>
  SPECTRAL_DECISIONS.some((d) => d.code === v);

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Proposition n° 1 d'une analyse, ou null en cas d'abstention (lue dans la réponse enregistrée). */
function topProposal(output: SpectralIdentifyResponse): { polymer: string; label: string } | null {
  if (output.status === "not_identified") return null;
  const top = output.candidates[0];
  return top ? { polymer: top.polymer, label: top.label } : null;
}

function polymerLabelOf(output: SpectralIdentifyResponse, code: string | null): string | null {
  if (code === null) return null;
  const found =
    output.correction_vocabulary.find((p) => p.code === code) ??
    output.candidates.find((c) => c.polymer === code);
  return found?.label ?? null;
}

async function userNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function requireStudy(ctx: LabContext, studyId: string) {
  const study = await prisma.study.findFirst({
    where: { id: studyId, laboratoryId: ctx.laboratoryId },
    select: { id: true, archivedAt: true },
  });
  if (!study) throw new DomainError("Étude introuvable.");
  return study;
}

/** État du modèle spectral du moteur (viewer). */
export async function getSpectralModel(ctx: LabContext): Promise<SpectralModelState> {
  void ctx; // tout membre du laboratoire peut lire l'état du modèle ; rien de ce laboratoire n'est lu
  try {
    const info = await engineClient.spectralModel();
    return { kind: info.available ? "ok" : "unavailable", info };
  } catch (e) {
    if (e instanceof EngineUnavailableError) return { kind: "engine_down" };
    throw e;
  }
}

type PredictionRow = Prisma.ModelPredictionGetPayload<object>;

/** Dernière décision par analyse (la plus récente fait foi), avec leur nombre. */
async function latestDecisions(
  ctx: LabContext,
  studyId: string,
): Promise<Map<string, SpectralDecisionView>> {
  const rows = await prisma.modelPrediction.findMany({
    where: {
      studyId,
      kind: "spectral",
      status: { not: "proposed" },
      study: { laboratoryId: ctx.laboratoryId },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_DECISIONS,
  });
  const names = await userNames(rows.map((r) => r.decidedById));
  const latest = new Map<string, SpectralDecisionView>();
  for (const r of rows) {
    const input = (r.input ?? {}) as StoredInput;
    if (typeof input.analysisId !== "string") continue;
    const seen = latest.get(input.analysisId);
    if (seen) {
      seen.count += 1;
      continue;
    }
    latest.set(input.analysisId, {
      id: r.id,
      decision: isDecision(input.decision) ? input.decision : (r.status as SpectralDecision),
      polymer: typeof input.polymer === "string" ? input.polymer : null,
      polymerLabel: null,
      note: r.decisionNote,
      decidedBy: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
      decidedAt: r.decidedAt ?? r.createdAt,
      count: 1,
    });
  }
  return latest;
}

function toRow(r: PredictionRow, decisions: Map<string, SpectralDecisionView>): SpectralAnalysisRow {
  const input = (r.input ?? {}) as StoredInput;
  const output = r.output as unknown as SpectralIdentifyResponse;
  const decision = decisions.get(r.id) ?? null;
  if (decision) decision.polymerLabel = polymerLabelOf(output, decision.polymer);
  return {
    id: r.id,
    createdAt: r.createdAt,
    fileName: str(input.fileName),
    techniqueLabel: output.input.technique_label,
    status: output.status,
    statusLabel: output.status_label,
    proposedLabel: topProposal(output)?.label ?? null,
    modelVersion: r.modelVersion,
    decision,
  };
}

/** Analyses d'une étude, la plus récente d'abord, avec leur dernière décision (viewer). */
export async function listSpectralAnalyses(
  ctx: LabContext,
  studyId: string,
): Promise<{ rows: SpectralAnalysisRow[]; hidden: number }> {
  await requireStudy(ctx, studyId);
  const where = {
    studyId,
    kind: "spectral" as const,
    status: "proposed" as const,
    study: { laboratoryId: ctx.laboratoryId },
  };
  const [rows, total] = await Promise.all([
    prisma.modelPrediction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_ANALYSES,
    }),
    prisma.modelPrediction.count({ where }),
  ]);
  const decisions = await latestDecisions(ctx, studyId);
  return { rows: rows.map((r) => toRow(r, decisions)), hidden: Math.max(0, total - rows.length) };
}

/** Une analyse avec sa réponse complète, ou null (autre étude, autre laboratoire, identifiant inconnu). */
export async function getSpectralAnalysis(
  ctx: LabContext,
  studyId: string,
  analysisId: string,
): Promise<SpectralAnalysisView | null> {
  const study = await prisma.study.findFirst({
    where: { id: studyId, laboratoryId: ctx.laboratoryId },
    select: { archivedAt: true },
  });
  if (!study) return null;
  const r = await prisma.modelPrediction.findFirst({
    where: {
      id: analysisId,
      studyId,
      kind: "spectral",
      status: "proposed",
      study: { laboratoryId: ctx.laboratoryId },
    },
  });
  if (!r) return null;
  const decisions = await latestDecisions(ctx, studyId);
  const row = toRow(r, decisions);
  const input = r.input as StoredInput;
  const creator = await prisma.auditEvent.findFirst({
    where: {
      laboratoryId: ctx.laboratoryId,
      action: "spectral.analysis",
      entityType: "ModelPrediction",
      entityId: r.id,
    },
    select: { actorId: true },
  });
  const names = await userNames([creator?.actorId ?? null]);
  return {
    ...row,
    createdBy: creator?.actorId ? (names.get(creator.actorId) ?? null) : null,
    sizeBytes: typeof input.sizeBytes === "number" ? input.sizeBytes : 0,
    inputSha256: r.inputFileSha256 ?? "",
    technique: str(input.technique),
    xUnit: str(input.xUnit),
    yUnit: str(input.yUnit),
    laserNm: typeof input.laserNm === "number" ? input.laserNm : null,
    modelName: r.modelName,
    modelSha256: r.modelSha256,
    output: r.output as unknown as SpectralIdentifyResponse,
    archived: study.archivedAt !== null,
  };
}

const inList = (list: readonly { code: string }[], value: unknown) =>
  typeof value === "string" && list.some((o) => o.code === value);

/**
 * Analyse un spectre : le moteur calcule, le serveur enregistre sa réponse telle quelle (nouvelle ligne),
 * le fichier va au magasin adressé par contenu. Un même dépôt avec les mêmes paramètres et le même
 * modèle renvoie l'analyse existante.
 */
export async function analyzeSpectrum(
  ctx: LabContext,
  studyId: string,
  input: AnalyzeInput,
): Promise<{ id: string; existing: boolean }> {
  assertRole(ctx, "researcher");
  const laserText =
    input.laserNm === null || input.laserNm === undefined ? "" : String(input.laserNm).trim();
  if (
    !inList(TECHNIQUE_OPTIONS, input.technique) ||
    !inList(X_UNIT_OPTIONS, input.xUnit) ||
    !inList(Y_UNIT_OPTIONS, input.yUnit) ||
    (laserText !== "" && !LASER_PATTERN.test(laserText))
  ) {
    throw new DomainError("Paramètres d'analyse invalides.");
  }
  const laser = laserText === "" ? null : laserText.replace(",", ".");
  if (input.bytes.length === 0) throw new DomainError("Aucun fichier reçu.");
  if (input.bytes.length > SPECTRAL_MAX_BYTES) {
    throw new DomainError("Fichier trop volumineux (2 Mo maximum).");
  }
  const study = await requireStudy(ctx, studyId);
  assertWritable(study);

  const sha256 = sha256Of(input.bytes);
  let response: SpectralIdentifyResponse;
  try {
    response = await engineClient.identifySpectrum({
      file: { data: input.bytes, filename: "spectre" },
      technique: input.technique,
      xUnit: input.xUnit,
      yUnit: input.yUnit,
      laserNm: laser,
    });
  } catch (e) {
    if (e instanceof EngineError) {
      if (e.status === 422 || e.status === 413) throw new DomainError(e.detail);
      if (e.status === 503) throw new DomainError(SPECTRAL_MODEL_UNAVAILABLE);
      throw new DomainError(SPECTRAL_REFUSED);
    }
    throw e;
  }
  if (response.input.sha256 !== sha256) {
    throw new DomainError("Le moteur n'a pas analysé le fichier déposé : recommencez.");
  }

  const laserNumber = laser === null ? null : Number(laser);
  const findExisting = async (db: Pick<typeof prisma, "modelPrediction">) => {
    const candidates = await db.modelPrediction.findMany({
      where: {
        studyId,
        kind: "spectral",
        status: "proposed",
        inputFileSha256: sha256,
        modelSha256: response.model.sha256,
        study: { laboratoryId: ctx.laboratoryId },
      },
      select: { id: true, input: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return candidates.find((c) => {
      const i = c.input as StoredInput;
      return (
        i.technique === input.technique &&
        i.xUnit === input.xUnit &&
        i.yUnit === input.yUnit &&
        (i.laserNm ?? null) === laserNumber
      );
    });
  };
  // Magasin adressé par contenu, hors transaction : un orphelin est toléré (comme pour les imports).
  // Idempotent : un nouvel envoi restaure aussi un fichier disparu du magasin (octets vérifiés).
  const storagePath = await storeFile(sha256, input.bytes);
  const known = await findExisting(prisma);
  if (known) return { id: known.id, existing: true };
  const top = topProposal(response);

  return prisma.$transaction(async (tx) => {
    await loadWritable(tx, ctx, studyId);
    // Verrou sur l'étude : deux dépôts simultanés du même spectre ne créent qu'une analyse.
    await lockWritableStudy(tx, ctx, studyId);
    const raced = await findExisting(tx as unknown as typeof prisma);
    if (raced) return { id: raced.id, existing: true };
    const row = await tx.modelPrediction.create({
      data: {
        studyId,
        kind: "spectral",
        inputFileSha256: sha256,
        input: {
          role: "analysis",
          fileName: input.fileName,
          sizeBytes: input.bytes.length,
          mimeType: input.mimeType,
          storagePath,
          technique: input.technique,
          xUnit: input.xUnit,
          yUnit: input.yUnit,
          laserNm: laserNumber,
        },
        output: response as unknown as Prisma.InputJsonValue,
        score: top ? (response.candidates[0]?.score ?? null) : null,
        modelName: response.model.name,
        modelVersion: response.model.version,
        modelSha256: response.model.sha256,
        status: "proposed",
      },
    });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "spectral.analysis",
      entityType: "ModelPrediction",
      entityId: row.id,
      laboratoryId: ctx.laboratoryId,
      // Ni nom de fichier ni contenu : un nom de fichier peut porter un nom de personne.
      after: {
        kind: "spectral",
        studyId,
        technique: input.technique,
        status: response.status,
        proposedPolymer: top?.polymer ?? null,
        proposedLabel: top?.label ?? null,
        modelVersion: response.model.version,
        inputSha256: sha256,
      },
    });
    return { id: row.id, existing: false };
  });
}

/**
 * Enregistre une décision humaine (nouvelle ligne, rien n'est modifié). Les règles sont lues dans la
 * réponse enregistrée de l'analyse, jamais dans une donnée du navigateur ; aucun appel au moteur.
 */
export async function recordSpectralDecision(
  ctx: LabContext,
  studyId: string,
  analysisId: string,
  input: { decision: string; polymer?: string | null; note?: string | null },
): Promise<{ id: string }> {
  assertRole(ctx, "researcher");
  const decision = SPECTRAL_DECISIONS.find((d) => d.code === input.decision);
  if (!decision) throw new DomainError("Décision inconnue.");
  // Une note qui n'est pas du texte compte comme absente (jamais d'erreur technique).
  const note = (typeof input.note === "string" ? input.note : "").trim();
  if (note.length > NOTE_MAX_LENGTH) throw new DomainError("La note dépasse 1 000 caractères.");
  const study = await requireStudy(ctx, studyId);
  assertWritable(study);
  if (typeof analysisId !== "string") throw new DomainError("Analyse introuvable.");
  const analysis = await prisma.modelPrediction.findFirst({
    where: {
      id: analysisId,
      studyId,
      kind: "spectral",
      status: "proposed",
      study: { laboratoryId: ctx.laboratoryId },
    },
  });
  if (!analysis) throw new DomainError("Analyse introuvable.");
  const output = analysis.output as unknown as SpectralIdentifyResponse;
  const top = topProposal(output);

  let polymer: string | null = null;
  if (decision.code === "accepted") {
    if (!top) throw new DomainError("Aucune proposition à accepter : corrigez ou rejetez.");
    polymer = top.polymer;
  } else if (decision.code === "corrected") {
    const chosen = typeof input.polymer === "string" ? input.polymer.trim() : "";
    if (chosen === "") throw new DomainError("Choisissez le polymère retenu.");
    if (!output.correction_vocabulary.some((p) => p.code === chosen)) {
      throw new DomainError("Polymère inconnu.");
    }
    if (top && chosen === top.polymer) {
      throw new DomainError("Le polymère choisi est celui proposé : choisissez « Acceptée ».");
    }
    if (NOTE_REQUIRED_POLYMERS.includes(chosen) && note === "") {
      throw new DomainError(
        "Une note est obligatoire pour « Autre polymère » ou « Non plastique ».",
      );
    }
    polymer = chosen;
  }
  if (decision.noteRequired && note === "") {
    throw new DomainError("Une note est obligatoire pour rejeter une proposition.");
  }
  const polymerLabel = polymerLabelOf(output, polymer);

  return prisma.$transaction(async (tx) => {
    await loadWritable(tx, ctx, studyId);
    // Verrou sur l'étude : l'ordre des décisions est strictement croissant, même avec plusieurs serveurs.
    await lockWritableStudy(tx, ctx, studyId);
    const latest = await tx.modelPrediction.findFirst({
      where: {
        studyId,
        kind: "spectral",
        OR: [{ id: analysisId }, { input: { path: ["analysisId"], equals: analysisId } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    });
    const now = new Date();
    const createdAt =
      latest && latest.createdAt.getTime() >= now.getTime()
        ? new Date(latest.createdAt.getTime() + 1)
        : now;
    const row = await tx.modelPrediction.create({
      data: {
        studyId,
        kind: "spectral",
        inputFileSha256: analysis.inputFileSha256,
        input: { role: "decision", analysisId, decision: decision.code, polymer },
        output: {
          analysisId,
          proposedPolymer: top?.polymer ?? null,
          proposedStatus: output.status,
        },
        score: analysis.score,
        modelName: analysis.modelName,
        modelVersion: analysis.modelVersion,
        modelSha256: analysis.modelSha256,
        status: decision.status,
        decidedById: ctx.userId,
        decidedAt: now,
        decisionNote: note === "" ? null : note,
        createdAt,
      },
    });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "spectral.decision",
      entityType: "ModelPrediction",
      entityId: row.id,
      laboratoryId: ctx.laboratoryId,
      // Le texte de la note reste dans ModelPrediction ; l'audit n'en garde que la présence.
      after: {
        kind: "spectral",
        studyId,
        analysisId,
        decision: decision.code,
        polymer,
        polymerLabel,
        proposedPolymer: top?.polymer ?? null,
        modelVersion: analysis.modelVersion,
        hasNote: note !== "",
      },
    });
    return { id: row.id };
  });
}
