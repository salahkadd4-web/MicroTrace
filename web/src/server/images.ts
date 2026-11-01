import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { IMAGE_MODEL_UNAVAILABLE, IMAGE_REFUSED } from "@/lib/engine-messages";
import {
  IMAGE_DECISIONS,
  IMAGE_MAX_BYTES,
  MAX_MISSED,
  type ImageDecision,
} from "@/lib/images";
import { NOTE_MAX_LENGTH } from "@/lib/quality";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import {
  EngineError,
  EngineUnavailableError,
  engineClient,
  type ImageAnalyzeResponse,
  type ImageModelInfo,
  type ImageValidatedSummary,
} from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { readStoredFile, storeFile } from "@/server/file-store";
import type { LabContext } from "@/server/lab-context";
import { assertRole } from "@/server/lab-role";
import type { DownloadFile } from "@/server/report-download";
import { parisDay, toCsv, type CsvValue } from "@/server/report-files";
import { assertWritable, loadWritable } from "@/server/studies";
import { lockWritableStudy } from "@/server/study-lock";

/** Au plus ce nombre d'analyses est lu par étude (le reste est compté dans `hidden`). */
const MAX_ANALYSES = 500;
/** Au plus ce nombre de décisions est lu par étude (reporté au suivi : pagination). */
const MAX_DECISIONS = 5000;
/** Une analyse porte au plus 300 particules : autant d'identifiants dans une correction. */
const MAX_IDS = 300;
const SCALE_PATTERN = /^\d{1,4}(?:[.,]\d{1,6})?$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ImageAnalysisOutput = Omit<ImageAnalyzeResponse, "images">;

export type ImageModelState =
  | { kind: "ok" | "unavailable"; info: ImageModelInfo }
  | { kind: "engine_down" };

export type ImageDecisionView = {
  id: string;
  decision: ImageDecision;
  validated: ImageValidatedSummary | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: Date;
  /** Nombre de décisions enregistrées sur l'analyse (la plus récente fait foi). */
  count: number;
  excluded: number[];
  reshaped: { id: number; shape: string }[];
  missed: number;
};

export type ImageAnalysisRow = {
  id: string;
  createdAt: Date;
  fileName: string;
  status: string;
  statusLabel: string;
  count: number;
  scaleSource: string;
  scaleSourceLabel: string;
  modelVersion: string;
  decision: ImageDecisionView | null;
};

export type ImageAnalysisView = ImageAnalysisRow & {
  createdBy: string | null;
  sizeBytes: number;
  inputSha256: string;
  scaleEntered: string | null;
  modelName: string;
  modelSha256: string | null;
  output: ImageAnalysisOutput;
  archived: boolean;
};

export type ValidatedCountRow = {
  analysisId: string;
  decisionId: string;
  decidedAt: Date;
  decision: ImageDecision;
  validated: ImageValidatedSummary;
  medianFeretUm: number | null;
};

export type AnalyzeImageInput = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
  scaleUmPerPx: string | null;
};

type StoredInput = {
  role?: unknown;
  fileName?: unknown;
  sizeBytes?: unknown;
  scaleEntered?: unknown;
  displaySha256?: unknown;
  annotatedSha256?: unknown;
  analysisId?: unknown;
  decision?: unknown;
  excluded?: unknown;
  reshaped?: unknown;
  missedCount?: unknown;
};

type Reshape = { id: number; shape: string };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isDecision = (v: unknown): v is ImageDecision => IMAGE_DECISIONS.some((d) => d.code === v);

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const numbers = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];

function reshapes(v: unknown): Reshape[] {
  if (!Array.isArray(v)) return [];
  const out: Reshape[] = [];
  for (const r of v) {
    if (r && typeof r === "object") {
      const { id, shape } = r as { id?: unknown; shape?: unknown };
      if (typeof id === "number" && typeof shape === "string") out.push({ id, shape });
    }
  }
  return out;
}

/** Moyenne des scores de forme, ou null sans particule (calcul d'enregistrement, pas d'analyse). */
function meanScore(output: ImageAnalysisOutput): number | null {
  if (output.particles.length === 0) return null;
  return output.particles.reduce((s, p) => s + p.shape_score, 0) / output.particles.length;
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
    select: { id: true, archivedAt: true, nature: true },
  });
  if (!study) throw new DomainError("Étude introuvable.");
  return study;
}

/** État du modèle d'images du moteur (viewer). */
export async function getImageModel(ctx: LabContext): Promise<ImageModelState> {
  void ctx; // tout membre du laboratoire peut lire l'état du modèle ; rien de ce laboratoire n'est lu
  try {
    const info = await engineClient.imageModel();
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
): Promise<Map<string, ImageDecisionView>> {
  const rows = await prisma.modelPrediction.findMany({
    where: {
      studyId,
      kind: "image",
      status: { not: "proposed" },
      study: { laboratoryId: ctx.laboratoryId },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_DECISIONS,
  });
  const names = await userNames(rows.map((r) => r.decidedById));
  const latest = new Map<string, ImageDecisionView>();
  for (const r of rows) {
    const input = (r.input ?? {}) as StoredInput;
    if (typeof input.analysisId !== "string") continue;
    const seen = latest.get(input.analysisId);
    if (seen) {
      seen.count += 1;
      continue;
    }
    const output = (r.output ?? {}) as { validated?: ImageValidatedSummary | null };
    latest.set(input.analysisId, {
      id: r.id,
      decision: isDecision(input.decision) ? input.decision : (r.status as ImageDecision),
      validated: output.validated ?? null,
      note: r.decisionNote,
      decidedBy: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
      decidedAt: r.decidedAt ?? r.createdAt,
      count: 1,
      excluded: numbers(input.excluded),
      reshaped: reshapes(input.reshaped),
      missed: typeof input.missedCount === "number" ? input.missedCount : 0,
    });
  }
  return latest;
}

function toRow(r: PredictionRow, decisions: Map<string, ImageDecisionView>): ImageAnalysisRow {
  const input = (r.input ?? {}) as StoredInput;
  const output = r.output as unknown as ImageAnalysisOutput;
  return {
    id: r.id,
    createdAt: r.createdAt,
    fileName: str(input.fileName),
    status: output.status,
    statusLabel: output.status_label,
    count: output.count,
    scaleSource: output.scale?.source ?? "none",
    scaleSourceLabel: output.scale?.source_label ?? "inconnue",
    modelVersion: r.modelVersion,
    decision: decisions.get(r.id) ?? null,
  };
}

/** Analyses d'une étude, la plus récente d'abord, avec leur dernière décision (viewer). */
export async function listImageAnalyses(
  ctx: LabContext,
  studyId: string,
): Promise<{ rows: ImageAnalysisRow[]; hidden: number }> {
  await requireStudy(ctx, studyId);
  const where = {
    studyId,
    kind: "image" as const,
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

/** Comptages validés : dernière décision de chaque analyse, si elle est acceptée ou corrigée. */
export async function listValidatedCounts(
  ctx: LabContext,
  studyId: string,
): Promise<ValidatedCountRow[]> {
  await requireStudy(ctx, studyId);
  const decisions = await latestDecisions(ctx, studyId);
  const rows: ValidatedCountRow[] = [];
  for (const [analysisId, d] of decisions) {
    if ((d.decision !== "accepted" && d.decision !== "corrected") || !d.validated) continue;
    rows.push({
      analysisId,
      decisionId: d.id,
      decidedAt: d.decidedAt,
      decision: d.decision,
      validated: d.validated,
      medianFeretUm: d.validated.size_distribution?.median_um ?? null,
    });
  }
  return rows.sort(
    (a, b) =>
      b.decidedAt.getTime() - a.decidedAt.getTime() || b.decisionId.localeCompare(a.decisionId),
  );
}

async function findAnalysis(ctx: LabContext, studyId: string, analysisId: string) {
  if (typeof analysisId !== "string") return null;
  return prisma.modelPrediction.findFirst({
    where: {
      id: analysisId,
      studyId,
      kind: "image",
      status: "proposed",
      study: { laboratoryId: ctx.laboratoryId },
    },
  });
}

/** Une analyse avec sa réponse complète, ou null (autre étude, autre laboratoire, identifiant inconnu). */
export async function getImageAnalysis(
  ctx: LabContext,
  studyId: string,
  analysisId: string,
): Promise<ImageAnalysisView | null> {
  const study = await prisma.study.findFirst({
    where: { id: studyId, laboratoryId: ctx.laboratoryId },
    select: { archivedAt: true },
  });
  if (!study) return null;
  const r = await findAnalysis(ctx, studyId, analysisId);
  if (!r) return null;
  const decisions = await latestDecisions(ctx, studyId);
  const row = toRow(r, decisions);
  const input = r.input as StoredInput;
  const names = await userNames([r.createdById]);
  return {
    ...row,
    createdBy: r.createdById ? (names.get(r.createdById) ?? null) : null,
    sizeBytes: typeof input.sizeBytes === "number" ? input.sizeBytes : 0,
    inputSha256: r.inputFileSha256 ?? "",
    scaleEntered: typeof input.scaleEntered === "string" ? input.scaleEntered : null,
    modelName: r.modelName,
    modelSha256: r.modelSha256,
    output: r.output as unknown as ImageAnalysisOutput,
    archived: study.archivedAt !== null,
  };
}

/** Octets d'une des deux images réécrites par le moteur, ou null (analyse étrangère, fichier absent). */
export async function readAnalysisImage(
  ctx: LabContext,
  studyId: string,
  analysisId: string,
  which: "display" | "annotated",
): Promise<Buffer | null> {
  const r = await findAnalysis(ctx, studyId, analysisId);
  if (!r) return null;
  const input = r.input as StoredInput;
  const sha = which === "display" ? input.displaySha256 : input.annotatedSha256;
  if (typeof sha !== "string") return null;
  return readStoredFile(sha);
}

function decodePng(base64: string): Buffer {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new DomainError(IMAGE_REFUSED);
  }
  return bytes;
}

/**
 * Analyse une image : le moteur calcule, le serveur enregistre sa réponse (sans les images) en
 * nouvelle ligne. Seules les deux images réécrites par le moteur (sans métadonnée) vont au magasin :
 * le fichier déposé n'est jamais écrit. Un même dépôt avec la même échelle et le même modèle renvoie
 * l'analyse existante.
 */
export async function analyzeImage(
  ctx: LabContext,
  studyId: string,
  input: AnalyzeImageInput,
): Promise<{ id: string; existing: boolean }> {
  assertRole(ctx, "researcher");
  const scaleText =
    input.scaleUmPerPx === null || input.scaleUmPerPx === undefined
      ? ""
      : String(input.scaleUmPerPx).trim();
  if (input.bytes.length === 0) throw new DomainError("Aucun fichier reçu.");
  if (input.bytes.length > IMAGE_MAX_BYTES) {
    throw new DomainError("Fichier trop volumineux (25 Mo maximum).");
  }
  if (scaleText !== "" && !SCALE_PATTERN.test(scaleText)) throw new DomainError("Échelle invalide.");
  const scale = scaleText === "" ? null : scaleText.replace(",", ".");
  const study = await requireStudy(ctx, studyId);
  assertWritable(study);

  const sha256 = sha256Of(input.bytes);
  let response: ImageAnalyzeResponse;
  try {
    response = await engineClient.analyzeImage({
      file: { data: input.bytes, filename: "image" },
      scaleUmPerPx: scale,
    });
  } catch (e) {
    if (e instanceof EngineError) {
      if (e.status === 422 || e.status === 413) throw new DomainError(e.detail);
      if (e.status === 503) throw new DomainError(IMAGE_MODEL_UNAVAILABLE);
      throw new DomainError(IMAGE_REFUSED);
    }
    throw e;
  }
  if (response.input.sha256 !== sha256) {
    throw new DomainError("Le moteur n'a pas analysé le fichier déposé : recommencez.");
  }

  const findExisting = async (db: Pick<typeof prisma, "modelPrediction">) => {
    const candidates = await db.modelPrediction.findMany({
      where: {
        studyId,
        kind: "image",
        status: "proposed",
        inputFileSha256: sha256,
        modelSha256: response.model.sha256,
        study: { laboratoryId: ctx.laboratoryId },
      },
      select: { id: true, input: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return candidates.find((c) => ((c.input as StoredInput).scaleEntered ?? null) === scale);
  };
  const known = await findExisting(prisma);
  if (known) return { id: known.id, existing: true };

  // Les deux images viennent du moteur (PNG sans métadonnée) ; le fichier déposé n'est pas stocké.
  const { images, ...output } = response;
  const display = decodePng(images.display_png_base64);
  const annotated = decodePng(images.annotated_png_base64);
  const displaySha256 = sha256Of(display);
  const annotatedSha256 = sha256Of(annotated);
  // Magasin adressé par contenu, hors transaction : un orphelin est toléré (comme pour les imports).
  await storeFile(displaySha256, display);
  await storeFile(annotatedSha256, annotated);

  return prisma.$transaction(async (tx) => {
    await loadWritable(tx, ctx, studyId);
    // Verrou sur l'étude : deux dépôts simultanés de la même image ne créent qu'une analyse.
    await lockWritableStudy(tx, ctx, studyId);
    const raced = await findExisting(tx as unknown as typeof prisma);
    if (raced) return { id: raced.id, existing: true };
    const row = await tx.modelPrediction.create({
      data: {
        studyId,
        kind: "image",
        inputFileSha256: sha256,
        input: {
          role: "analysis",
          fileName: input.fileName,
          sizeBytes: input.bytes.length,
          mimeType: input.mimeType,
          scaleEntered: scale,
          displaySha256,
          annotatedSha256,
        },
        output: output as unknown as Prisma.InputJsonValue,
        score: meanScore(output),
        modelName: response.model.name,
        modelVersion: response.model.version,
        modelSha256: response.model.sha256,
        status: "proposed",
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "image.analysis",
      entityType: "ModelPrediction",
      entityId: row.id,
      laboratoryId: ctx.laboratoryId,
      // Ni nom de fichier ni contenu : un nom de fichier peut porter un nom de personne.
      after: {
        kind: "image",
        studyId,
        status: response.status,
        count: response.count,
        scaleSource: response.scale?.source ?? "none",
        modelVersion: response.model.version,
        inputSha256: sha256,
      },
    });
    return { id: row.id, existing: false };
  });
}

const INVALID_CORRECTIONS = "Corrections invalides.";

type Corrections = { excluded: number[]; reshaped: Reshape[]; missed: number };

/** Contrôle de forme seulement (types, longueurs) : le moteur revérifie les identifiants et les formes. */
function parseCorrections(input: {
  excluded?: unknown;
  reshaped?: unknown;
  missed?: unknown;
}): Corrections {
  const excludedRaw = input.excluded ?? [];
  const reshapedRaw = input.reshaped ?? [];
  const missed = input.missed ?? 0;
  if (!Array.isArray(excludedRaw) || !Array.isArray(reshapedRaw)) {
    throw new DomainError(INVALID_CORRECTIONS);
  }
  if (excludedRaw.length + reshapedRaw.length > MAX_IDS) throw new DomainError(INVALID_CORRECTIONS);
  if (typeof missed !== "number" || !Number.isInteger(missed) || missed < 0 || missed > MAX_MISSED) {
    throw new DomainError(INVALID_CORRECTIONS);
  }
  const excluded: number[] = [];
  for (const id of excludedRaw) {
    if (typeof id !== "number" || !Number.isInteger(id)) throw new DomainError(INVALID_CORRECTIONS);
    excluded.push(id);
  }
  const reshaped: Reshape[] = [];
  for (const r of reshapedRaw) {
    const { id, shape } = (r ?? {}) as { id?: unknown; shape?: unknown };
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      typeof shape !== "string" ||
      shape.length === 0 ||
      shape.length > 32
    ) {
      throw new DomainError(INVALID_CORRECTIONS);
    }
    reshaped.push({ id, shape });
  }
  const ids = [...excluded, ...reshaped.map((r) => r.id)];
  if (new Set(ids).size !== ids.length) throw new DomainError(INVALID_CORRECTIONS);
  return { excluded, reshaped, missed };
}

/**
 * Enregistre une décision humaine (nouvelle ligne, rien n'est modifié). Les règles sont lues dans la
 * réponse enregistrée de l'analyse ; le moteur recalcule le comptage validé à partir des particules
 * enregistrées et des corrections, jamais d'une donnée du navigateur.
 */
export async function recordImageDecision(
  ctx: LabContext,
  studyId: string,
  analysisId: string,
  input: {
    decision: string;
    excluded?: number[];
    reshaped?: { id: number; shape: string }[];
    missed?: number;
    note?: string | null;
  },
): Promise<{ id: string }> {
  assertRole(ctx, "researcher");
  const decision = IMAGE_DECISIONS.find((d) => d.code === input.decision);
  if (!decision) throw new DomainError("Décision inconnue.");
  // Une note qui n'est pas du texte compte comme absente (jamais d'erreur technique).
  const note = (typeof input.note === "string" ? input.note : "").trim();
  if (note.length > NOTE_MAX_LENGTH) throw new DomainError("La note dépasse 1 000 caractères.");
  const study = await requireStudy(ctx, studyId);
  assertWritable(study);
  const analysis = await findAnalysis(ctx, studyId, analysisId);
  if (!analysis) throw new DomainError("Analyse introuvable.");
  const output = analysis.output as unknown as ImageAnalysisOutput;
  const { excluded, reshaped, missed } = parseCorrections(input);
  const hasCorrections = excluded.length > 0 || reshaped.length > 0 || missed > 0;

  if (decision.code === "accepted") {
    if (output.status === "unreliable") {
      throw new DomainError("Aucune proposition à accepter : corrigez ou rejetez.");
    }
    if (hasCorrections) {
      throw new DomainError("Une acceptation ne porte pas de correction : choisissez « Corrigée ».");
    }
  } else if (decision.code === "corrected") {
    const proposed = new Map(output.particles.map((p) => [p.id, p.shape]));
    const shapeChanged = reshaped.some((r) => proposed.get(r.id) !== r.shape);
    if (excluded.length === 0 && !shapeChanged && missed === 0) {
      throw new DomainError(
        "Aucune correction saisie : choisissez « Acceptée » ou modifiez au moins une particule.",
      );
    }
  } else {
    if (note === "") throw new DomainError("Une note est obligatoire pour rejeter une proposition.");
    if (hasCorrections) throw new DomainError("Une proposition rejetée ne porte pas de correction.");
  }

  let validated: ImageValidatedSummary | null = null;
  if (decision.code !== "rejected") {
    try {
      validated = await engineClient.validateImage({
        analysis: { particles: output.particles, scale: output.scale, count: output.count },
        excluded,
        reshaped,
        missed_count: missed,
      });
    } catch (e) {
      if (e instanceof EngineError) {
        if (e.status === 422) throw new DomainError(e.detail);
        throw new DomainError(IMAGE_REFUSED);
      }
      throw e;
    }
  }

  return prisma.$transaction(async (tx) => {
    await loadWritable(tx, ctx, studyId);
    // Verrou sur l'étude : l'ordre des décisions est strictement croissant, même avec plusieurs serveurs.
    await lockWritableStudy(tx, ctx, studyId);
    const latest = await tx.modelPrediction.findFirst({
      where: {
        studyId,
        kind: "image",
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
        kind: "image",
        inputFileSha256: analysis.inputFileSha256,
        input: {
          role: "decision",
          analysisId,
          decision: decision.code,
          excluded,
          reshaped,
          missedCount: missed,
        },
        output: {
          analysisId,
          proposedStatus: output.status,
          proposedCount: output.count,
          validated: validated as unknown as Prisma.InputJsonValue,
        } as unknown as Prisma.InputJsonValue,
        score: analysis.score,
        modelName: analysis.modelName,
        modelVersion: analysis.modelVersion,
        modelSha256: analysis.modelSha256,
        status: decision.code,
        decidedById: ctx.userId,
        decidedAt: now,
        decisionNote: note === "" ? null : note,
        createdAt,
      },
    });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "image.decision",
      entityType: "ModelPrediction",
      entityId: row.id,
      laboratoryId: ctx.laboratoryId,
      // Le texte de la note reste dans ModelPrediction ; l'audit n'en garde que la présence.
      after: {
        kind: "image",
        studyId,
        analysisId,
        decision: decision.code,
        proposedCount: output.count,
        validatedCount: validated?.count ?? null,
        excluded,
        reshaped,
        missed,
        modelVersion: analysis.modelVersion,
        hasNote: note !== "",
      },
    });
    return { id: row.id };
  });
}

const COUNT_COLUMNS = [
  "analysis_id",
  "decision_id",
  "decided_at",
  "decision",
  "study_nature",
  "image_sha256",
  "scale_um_per_px",
  "scale_source",
  "count_validated",
  "count_fibre",
  "count_fragment",
  "count_bille",
  "count_film",
  "count_unspecified",
  "missed",
  "feret_median_um",
  "model_name",
  "model_version",
  "model_sha256",
];

const PARTICLE_COLUMNS = [
  "particle_id",
  "shape",
  "shape_label",
  "shape_score",
  "shape_status",
  "feret_max_um",
  "feret_min_um",
  "area_um2",
  "eq_diameter_um",
  "feret_max_px",
  "feret_min_px",
  "area_px",
  "touches_border",
  "validated_shape",
  "excluded",
];

const shapeCount = (summary: ImageValidatedSummary, ...shapes: string[]) =>
  summary.count_by_shape.filter((s) => shapes.includes(s.shape)).reduce((n, s) => n + s.count, 0);

/**
 * Comptages de particules candidates des images validées (une ligne par image). Ce ne sont pas des
 * mesures : rien ne va dans Measurement ni dans le rapport. Aucun nom de fichier (viewer).
 */
export async function buildCountsCsv(ctx: LabContext, studyId: string): Promise<DownloadFile> {
  const study = await requireStudy(ctx, studyId);
  const counts = (await listValidatedCounts(ctx, studyId)).reverse();
  const ids = counts.map((c) => c.analysisId);
  const analyses = await prisma.modelPrediction.findMany({
    where: {
      id: { in: ids },
      studyId,
      kind: "image",
      status: "proposed",
      study: { laboratoryId: ctx.laboratoryId },
    },
  });
  const byId = new Map(analyses.map((a) => [a.id, a]));
  const rows: CsvValue[][] = [];
  for (const c of counts) {
    const a = byId.get(c.analysisId);
    if (!a) continue;
    const output = a.output as unknown as ImageAnalysisOutput;
    rows.push([
      c.analysisId,
      c.decisionId,
      c.decidedAt.toISOString(),
      c.decision,
      study.nature,
      a.inputFileSha256,
      output.scale?.um_per_px_input ?? null,
      output.scale?.source ?? "none",
      c.validated.count,
      shapeCount(c.validated, "fibre"),
      shapeCount(c.validated, "fragment"),
      shapeCount(c.validated, "bille"),
      shapeCount(c.validated, "film"),
      // Les formes incertaines ou manquées ne sont pas renseignées : la somme des colonnes reste le total.
      shapeCount(c.validated, "unspecified", "uncertain"),
      c.validated.missed,
      c.medianFeretUm,
      a.modelName,
      a.modelVersion,
      a.modelSha256,
    ]);
  }
  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "image.counts_export",
      entityType: "Study",
      entityId: studyId,
      laboratoryId: ctx.laboratoryId,
      after: { studyId, rows: rows.length },
    });
  });
  return {
    body: toCsv(COUNT_COLUMNS, rows),
    contentType: "text/csv; charset=utf-8",
    fileName: `microtrace-comptages-particules-${parisDay(new Date())}.csv`,
  };
}

/** Particules d'une analyse (CSV), avec la forme retenue et l'exclusion de la dernière décision. */
export async function buildParticlesCsv(
  ctx: LabContext,
  studyId: string,
  analysisId: string,
): Promise<DownloadFile> {
  await requireStudy(ctx, studyId);
  const analysis = await findAnalysis(ctx, studyId, analysisId);
  if (!analysis) throw new DomainError("Analyse introuvable.");
  const output = analysis.output as unknown as ImageAnalysisOutput;
  const decision = (await latestDecisions(ctx, studyId)).get(analysis.id) ?? null;
  const kept = decision && decision.decision !== "rejected" ? decision : null;
  const excluded = new Set(kept?.excluded ?? []);
  const reshaped = new Map((kept?.reshaped ?? []).map((r) => [r.id, r.shape]));
  const rows: CsvValue[][] = output.particles.map((p) => [
    p.id,
    p.shape,
    p.shape_label,
    p.shape_score,
    p.shape_status,
    p.feret_max_um,
    p.feret_min_um,
    p.area_um2,
    p.eq_diameter_um,
    p.feret_max_px,
    p.feret_min_px,
    p.area_px,
    p.touches_border,
    kept && !excluded.has(p.id) ? (reshaped.get(p.id) ?? p.shape) : null,
    kept ? excluded.has(p.id) : null,
  ]);
  return {
    body: toCsv(PARTICLE_COLUMNS, rows),
    contentType: "text/csv; charset=utf-8",
    fileName: `microtrace-particules-${parisDay(new Date())}.csv`,
  };
}
