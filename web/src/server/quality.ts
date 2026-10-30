import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  NOTE_MAX_LENGTH,
  QUALITY_DECISIONS,
  type QualityDecision,
} from "@/lib/quality";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import {
  engineClient,
  type QualityRequest,
  type QualityResponse,
  type QualitySignal,
} from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import type { LabContext } from "@/server/lab-context";
import { assertRole } from "@/server/lab-role";
import { loadActiveResultsInput } from "@/server/results";
import { assertWritable, loadWritable } from "@/server/studies";

/** Au plus ce nombre de décisions est lu par étude (reporté au suivi : pagination). */
const MAX_DECISIONS = 5000;
const MODEL_NAME = "quality-rules";
const SIGNAL_KEY_PATTERN = /^[0-9a-f]{64}$/;

export type QualityDecisionView = {
  id: string;
  signalKey: string;
  decision: QualityDecision | null;
  status: string;
  note: string | null;
  decidedBy: string | null;
  decidedAt: Date;
  modelVersion: string;
  /** Le signal tel que le serveur l'a calculé au moment de la décision. */
  signal: QualitySignal;
  /** Nombre de décisions enregistrées sur ce signal (la plus récente fait foi). */
  count: number;
};

export type StudyQuality =
  | { kind: "empty"; disappeared: QualityDecisionView[] }
  | {
      kind: "ok";
      version: string;
      signals: { signal: QualitySignal; decision: QualityDecisionView | null }[];
      notes: QualityResponse["notes"];
      rules: QualityResponse["rules"];
      disappeared: QualityDecisionView[];
      importNames: Record<string, string>;
      mixedRulesVersions: boolean;
      contextChanged: boolean;
      archived: boolean;
    };

const DECISION_CODES = new Set<string>(QUALITY_DECISIONS.map((d) => d.code));

function isDecisionCode(value: unknown): value is QualityDecision {
  return typeof value === "string" && DECISION_CODES.has(value);
}

/** Dernière décision par clé de signal (la plus récente fait foi), avec le nombre de décisions. */
async function readDecisions(
  ctx: LabContext,
  studyId: string,
): Promise<Map<string, QualityDecisionView>> {
  const rows = await prisma.modelPrediction.findMany({
    where: { studyId, kind: "quality", study: { laboratoryId: ctx.laboratoryId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_DECISIONS,
  });
  const userIds = [...new Set(rows.map((r) => r.decidedById).filter((id): id is string => !!id))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const latest = new Map<string, QualityDecisionView>();
  for (const r of rows) {
    const input = (r.input ?? {}) as { signalKey?: unknown; decision?: unknown };
    if (typeof input.signalKey !== "string") continue;
    const seen = latest.get(input.signalKey);
    if (seen) {
      seen.count += 1;
      continue;
    }
    latest.set(input.signalKey, {
      id: r.id,
      signalKey: input.signalKey,
      decision: isDecisionCode(input.decision) ? input.decision : null,
      status: r.status,
      note: r.decisionNote,
      decidedBy: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
      decidedAt: r.decidedAt ?? r.createdAt,
      modelVersion: r.modelVersion,
      signal: r.output as unknown as QualitySignal,
      count: 1,
    });
  }
  return latest;
}

/** Recalcule les signaux : mesures actives (même instantané) puis moteur. Rien n'est stocké. */
async function computeSignals(ctx: LabContext, studyId: string) {
  const input = await loadActiveResultsInput(ctx, studyId, { withQcSummaries: true });
  if (input.records.length === 0) return { input, response: null };
  const shaOf = new Map(input.imports.map((i) => [i.id, i.sha256]));
  const sheetOf = new Map(input.imports.map((i) => [i.id, i.sheet ?? ""]));
  const request: QualityRequest = {
    records: input.records.map((r, i) => {
      const importId = input.recordImportIds[i];
      return {
        ...r,
        import_id: importId,
        file_sha256: shaOf.get(importId) ?? "",
        sheet: sheetOf.get(importId) ?? "",
      };
    }),
    qc_summaries: input.qcSummaries,
    blank_corrected: input.context.blank_corrected ?? "unknown",
  };
  const response = await engineClient.quality(request);
  return { input, response };
}

/** Signaux de qualité d'une étude, recalculés à chaque appel (viewer), avec les décisions enregistrées. */
export async function getStudyQuality(ctx: LabContext, studyId: string): Promise<StudyQuality> {
  const { input, response } = await computeSignals(ctx, studyId);
  const decisions = await readDecisions(ctx, studyId);
  if (!response) return { kind: "empty", disappeared: [...decisions.values()] };
  const present = new Set(response.signals.map((s) => s.key));
  return {
    kind: "ok",
    version: response.quality_rules_version,
    signals: response.signals.map((signal) => ({
      signal,
      decision: decisions.get(signal.key) ?? null,
    })),
    notes: response.notes,
    rules: response.rules,
    disappeared: [...decisions.values()].filter((d) => !present.has(d.signalKey)),
    importNames: Object.fromEntries(input.imports.map((i) => [i.id, i.fileName])),
    mixedRulesVersions: input.mixedRulesVersions,
    contextChanged: input.contextChanged,
    archived: input.study.archivedAt !== null,
  };
}

/**
 * Enregistre une décision humaine (nouvelle ligne, rien n'est modifié). Le signal est recalculé par le
 * serveur : seule la clé vient du navigateur.
 */
export async function recordQualityDecision(
  ctx: LabContext,
  studyId: string,
  input: { signalKey: string; decision: string; note?: string | null },
): Promise<{ id: string }> {
  assertRole(ctx, "researcher");
  const decision = QUALITY_DECISIONS.find((d) => d.code === input.decision);
  if (!decision) throw new DomainError("Décision inconnue.");
  // Une note qui n'est pas du texte compte comme absente (jamais d'erreur technique).
  const note = (typeof input.note === "string" ? input.note : "").trim();
  if (note.length > NOTE_MAX_LENGTH) throw new DomainError("La note dépasse 1 000 caractères.");
  if (decision.noteRequired && note === "") {
    throw new DomainError("Une note est obligatoire pour cette décision.");
  }
  // Une clé mal formée ne peut correspondre à aucun signal : refus avant tout accès au moteur.
  if (typeof input.signalKey !== "string" || !SIGNAL_KEY_PATTERN.test(input.signalKey)) {
    throw new DomainError("Ce signal n'existe plus : rechargez la page.");
  }
  // Étude du laboratoire et non archivée, avant tout appel au moteur.
  const study = await prisma.study.findFirst({
    where: { id: studyId, laboratoryId: ctx.laboratoryId },
    select: { archivedAt: true },
  });
  if (!study) throw new DomainError("Étude introuvable.");
  assertWritable(study);

  // Écart volontaire entre le recalcul (hors transaction, appel au moteur) et l'écriture : le signal
  // enregistré est celui que le serveur vient de calculer ; si les imports changent entre-temps, la
  // décision porte sur ce signal-là (sa copie est conservée dans `output`) et l'écran la classera
  // parmi les signaux disparus au prochain chargement.
  const { response } = await computeSignals(ctx, studyId);
  const signal = response?.signals.find((s) => s.key === input.signalKey);
  if (!response || !signal) {
    throw new DomainError("Ce signal n'existe plus : rechargez la page.");
  }
  const importIds = [...new Set(signal.records.map((r) => r.import_id))];

  return prisma.$transaction(async (tx) => {
    await loadWritable(tx, ctx, studyId);
    // Verrou sur l'étude : l'ordre des décisions est strictement croissant par étude, même avec
    // plusieurs serveurs web (createdAt = max(maintenant, dernière décision + 1 ms)).
    await tx.$queryRaw`SELECT id FROM "Study" WHERE id = ${studyId} FOR UPDATE`;
    const latest = await tx.modelPrediction.findFirst({
      where: { studyId, kind: "quality" },
      orderBy: { createdAt: "desc" },
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
        kind: "quality",
        modelName: MODEL_NAME,
        modelVersion: response.quality_rules_version,
        input: {
          signalKey: signal.key,
          rule: signal.rule,
          decision: decision.code,
          importIds,
        },
        output: signal as unknown as Prisma.InputJsonValue,
        status: decision.status,
        decisionNote: note === "" ? null : note,
        decidedById: ctx.userId,
        decidedAt: now,
        createdAt,
      },
    });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "quality.decision",
      entityType: "ModelPrediction",
      entityId: row.id,
      laboratoryId: ctx.laboratoryId,
      after: {
        studyId,
        signalKey: signal.key,
        rule: signal.rule,
        ruleTitle: signal.title,
        subject: signal.subject_label,
        decision: decision.code,
        modelVersion: response.quality_rules_version,
        hasNote: note !== "",
      },
    });
    return { id: row.id };
  });
}
