import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return {
    ...actual,
    engineClient: {
      validateContext: vi.fn(async () => ({})),
      spectralModel: vi.fn(),
      identifySpectrum: vi.fn(),
    },
  };
});

const dir = mkdtempSync(path.join(tmpdir(), "mt-spectral-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

import { prisma } from "@/server/db";
import {
  EngineError,
  EngineUnavailableError,
  engineClient,
  type SpectralIdentifyResponse,
  type SpectralModelInfo,
} from "@/server/engine/client";
import type { LabContext } from "@/server/lab-context";
import { createProject } from "@/server/projects";
import {
  analyzeSpectrum,
  getSpectralAnalysis,
  getSpectralModel,
  listSpectralAnalyses,
  recordSpectralDecision,
} from "@/server/spectral";
import { archiveStudy, createStudy } from "@/server/studies";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const identify = vi.mocked(engineClient.identifySpectrum);
const model = vi.mocked(engineClient.spectralModel);
const MODEL_SHA = "ab".repeat(32);
const VOCAB = [
  { code: "PE", label: "Polyéthylène (PE)" },
  { code: "PP", label: "Polypropylène (PP)" },
  { code: "OTHER", label: "Autre polymère" },
  { code: "NOT_PLASTIC", label: "Non plastique" },
];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function base(bytes: Uint8Array): SpectralIdentifyResponse {
  return {
    model: { name: "c5-spectral", version: "s1", sha256: MODEL_SHA },
    trial_label: "Modèle d'essai",
    trial_sentence: "Modèle d'essai : entraîné sur des données publiques, pas encore sur les vôtres.",
    input: {
      sha256: sha(bytes),
      size: bytes.length,
      n_points: 100,
      x_min: 100,
      x_max: 3000,
      technique: "raman",
      technique_label: "Raman",
      x_unit: "nm",
      y_unit: "intensity",
      laser_nm: 532,
      diagnostic_coverage: 1,
      window_min: 400,
      window_max: 1800,
    },
    status: "identified",
    status_label: "Identifié (proposition)",
    abstention: null,
    explanation: "texte",
    candidates: [
      { rank: 1, polymer: "PE", label: "Polyéthylène (PE)", score: 0.996, score_text: "0,996" },
      { rank: 2, polymer: "PP", label: "Polypropylène (PP)", score: 0.67, score_text: "0,670" },
    ],
    margin: 0.326,
    classifier_polymer: "PE",
    classifier_label: "Polyéthylène (PE)",
    references: [],
    query_curve: { x: [1, 2], y: [0, 1] },
    x_label: "x",
    y_label: "y",
    thresholds: {
      uncertain_min_score: 0.5,
      identified_min_score: 0.7,
      identified_min_margin: 0.1,
      classifier_agreement_required: true,
    },
    limits: ["l1"],
    correction_vocabulary: VOCAB,
  } as unknown as SpectralIdentifyResponse;
}
const IDENTIFIED = (b: Uint8Array) => base(b);
const ABSTAINED = (b: Uint8Array) =>
  ({
    ...base(b),
    status: "not_identified",
    status_label: "Non identifié (abstention)",
    abstention: "low_score",
    candidates: [],
    margin: null,
    classifier_polymer: null,
    classifier_label: null,
  }) as unknown as SpectralIdentifyResponse;

const BYTES = new TextEncoder().encode("100 1\n200 2\n");
const OTHER_BYTES = new TextEncoder().encode("100 1\n200 3\n");
const input = (over: Partial<Parameters<typeof analyzeSpectrum>[2]> = {}) => ({
  fileName: "mon-spectre-secret.txt",
  mimeType: "text/plain",
  bytes: BYTES as Uint8Array<ArrayBuffer>,
  technique: "raman",
  xUnit: "nm",
  yUnit: "intensity",
  laserNm: "532" as string | null,
  ...over,
});

let viewer: LabContext;
let researcher: LabContext;
let other: LabContext;
let studyId: string;
let otherStudyId: string;
let sameLabStudyId: string;

async function newStudy(c: LabContext, title: string) {
  const p = await createProject(c, { title: `P ${title}` });
  return (await createStudy(c, p.id, { title, nature: "laboratory", blankCorrected: "unknown" })).id;
}

beforeEach(async () => {
  await resetDb();
  rmSync(path.join(dir, "files"), { recursive: true, force: true });
  identify.mockReset();
  model.mockReset();
  identify.mockImplementation(async (a) => IDENTIFIED(a.file.data as Uint8Array));
  const lab = await makeLab("Labo A", "labo-a");
  const labB = await makeLab("Labo B", "labo-b");
  viewer = await makeMember(lab, "viewer", "v@example.org", "Vera");
  researcher = await makeMember(lab, "researcher", "r@example.org", "Rita");
  other = await makeMember(labB, "researcher", "b@example.org", "Bob");
  studyId = await newStudy(researcher, "E1");
  sameLabStudyId = await newStudy(researcher, "E2");
  otherStudyId = await newStudy(other, "EB");
});
afterEach(() => vi.useRealTimers());

const storeCount = () =>
  existsSync(path.join(dir, "files")) ? readdirSync(path.join(dir, "files")).length : 0;
async function counts() {
  return [await prisma.modelPrediction.count(), await prisma.auditEvent.count(), storeCount()];
}

describe("analyzeSpectrum", () => {
  it("écrit l'analyse, le fichier et l'audit", async () => {
    const { id, existing } = await analyzeSpectrum(researcher, studyId, input());
    expect(existing).toBe(false);
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      kind: "spectral",
      status: "proposed",
      inputFileSha256: sha(BYTES),
      score: 0.996,
      modelName: "c5-spectral",
      modelVersion: "s1",
      modelSha256: MODEL_SHA,
      decidedById: null,
      decisionNote: null,
      createdById: researcher.userId,
    });
    expect(row.input).toEqual({
      role: "analysis",
      fileName: "mon-spectre-secret.txt",
      sizeBytes: BYTES.length,
      mimeType: "text/plain",
      storagePath: `files/${sha(BYTES)}`,
      technique: "raman",
      xUnit: "nm",
      yUnit: "intensity",
      laserNm: 532,
    });
    expect(row.output).toEqual(IDENTIFIED(BYTES));
    expect(existsSync(path.join(dir, "files", sha(BYTES)))).toBe(true);
    const audit = await prisma.auditEvent.findMany({ where: { action: "spectral.analysis" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: "ModelPrediction", entityId: id, actorId: researcher.userId });
    const after = audit[0].after as Record<string, unknown>;
    expect(Object.keys(after).sort()).toEqual([
      "inputSha256",
      "kind",
      "modelVersion",
      "proposedLabel",
      "proposedPolymer",
      "status",
      "studyId",
      "technique",
    ]);
    expect(JSON.stringify(after)).not.toContain("secret");
  });

  it("abstention : score null, aucune proposition dans l'audit", async () => {
    identify.mockImplementation(async (a) => ABSTAINED(a.file.data as Uint8Array));
    const { id } = await analyzeSpectrum(researcher, studyId, input());
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect(row.score).toBeNull();
    const a = await prisma.auditEvent.findFirstOrThrow({ where: { action: "spectral.analysis" } });
    expect(a.after).toMatchObject({ status: "not_identified", proposedPolymer: null, proposedLabel: null });
  });

  it("idempotence : même dépôt deux fois, une seule analyse et un seul audit", async () => {
    const first = await analyzeSpectrum(researcher, studyId, input());
    const second = await analyzeSpectrum(researcher, studyId, input());
    expect(second).toEqual({ id: first.id, existing: true });
    expect(identify).toHaveBeenCalledTimes(2);
    expect(await prisma.modelPrediction.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "spectral.analysis" } })).toBe(1);
  });

  it("d'autres paramètres ou un autre fichier donnent une nouvelle analyse", async () => {
    await analyzeSpectrum(researcher, studyId, input());
    const b = await analyzeSpectrum(researcher, studyId, input({ laserNm: "785" }));
    const c = await analyzeSpectrum(
      researcher,
      studyId,
      input({ bytes: OTHER_BYTES as Uint8Array<ArrayBuffer> }),
    );
    expect(b.existing).toBe(false);
    expect(c.existing).toBe(false);
    expect(await prisma.modelPrediction.count()).toBe(3);
  });

  describe("refus sans écriture", () => {
    async function refused(c: LabContext, sid: string, i: ReturnType<typeof input>, message: string) {
      const before = await counts();
      await expect(analyzeSpectrum(c, sid, i)).rejects.toThrow(message);
      expect(await counts()).toEqual(before);
    }
    it("viewer", async () => {
      await refused(viewer, studyId, input(), "Action réservée aux chercheurs du laboratoire.");
      expect(identify).not.toHaveBeenCalled();
    });
    it("étude archivée", async () => {
      await archiveStudy(researcher, studyId, "fin");
      await refused(researcher, studyId, input(), "Étude archivée : lecture seule.");
      expect(identify).not.toHaveBeenCalled();
    });
    it("étude d'un autre laboratoire", async () => {
      await refused(researcher, otherStudyId, input(), "Étude introuvable.");
      expect(identify).not.toHaveBeenCalled();
    });
    it("fichier vide", async () => {
      await refused(
        researcher,
        studyId,
        input({ bytes: new Uint8Array(0) as Uint8Array<ArrayBuffer> }),
        "Aucun fichier reçu.",
      );
    });
    it("2 Mio + 1", async () => {
      const big = new Uint8Array(2 * 1024 * 1024 + 1) as Uint8Array<ArrayBuffer>;
      await refused(researcher, studyId, input({ bytes: big }), "Fichier trop volumineux (2 Mo maximum).");
      expect(identify).not.toHaveBeenCalled();
    });
    it("technique hors liste", async () => {
      await refused(researcher, studyId, input({ technique: "uv" }), "Paramètres d'analyse invalides.");
      expect(identify).not.toHaveBeenCalled();
    });
    it("laser non numérique", async () => {
      await refused(researcher, studyId, input({ laserNm: "vert" }), "Paramètres d'analyse invalides.");
      expect(identify).not.toHaveBeenCalled();
    });
    it("422 du moteur transmis", async () => {
      identify.mockRejectedValue(new EngineError(422, "Ligne 7 : valeurs non numériques."));
      await refused(researcher, studyId, input(), "Ligne 7 : valeurs non numériques.");
    });
    it("503 : modèle indisponible", async () => {
      identify.mockRejectedValue(new EngineError(503, "détail du moteur"));
      await refused(
        researcher,
        studyId,
        input(),
        "Le modèle spectral est indisponible : aucune analyse n'est possible pour l'instant.",
      );
    });
    it("autre erreur du moteur", async () => {
      identify.mockRejectedValue(new EngineError(500, "boum"));
      await refused(researcher, studyId, input(), "Le moteur d'analyse n'a pas pu analyser ce spectre.");
    });
    it("sha256 différent", async () => {
      identify.mockImplementation(async () => IDENTIFIED(OTHER_BYTES));
      await refused(
        researcher,
        studyId,
        input(),
        "Le moteur n'a pas analysé le fichier déposé : recommencez.",
      );
    });
    it("moteur injoignable : erreur relancée", async () => {
      identify.mockRejectedValue(new EngineUnavailableError());
      const before = await counts();
      await expect(analyzeSpectrum(researcher, studyId, input())).rejects.toBeInstanceOf(
        EngineUnavailableError,
      );
      expect(await counts()).toEqual(before);
    });
  });
});

describe("recordSpectralDecision", () => {
  async function analysis(abstained = false, sid = studyId) {
    if (abstained) identify.mockImplementation(async (a) => ABSTAINED(a.file.data as Uint8Array));
    return (await analyzeSpectrum(researcher, sid, input())).id;
  }

  it.each([
    ["accepted", undefined, undefined, "PE"],
    ["corrected", "PP", undefined, "PP"],
    ["rejected", undefined, "Pas du plastique, secret-note", null],
  ])("%s", async (decision, polymer, note, retained) => {
    const analysisId = await analysis();
    const { id } = await recordSpectralDecision(researcher, studyId, analysisId, { decision, polymer, note });
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      kind: "spectral",
      status: decision,
      inputFileSha256: sha(BYTES),
      decidedById: researcher.userId,
      decisionNote: note ?? null,
      modelName: "c5-spectral",
      modelVersion: "s1",
      modelSha256: MODEL_SHA,
      score: 0.996,
    });
    expect(row.decidedAt).not.toBeNull();
    expect(row.input).toEqual({ role: "decision", analysisId, decision, polymer: retained });
    expect(row.output).toEqual({ analysisId, proposedPolymer: "PE", proposedStatus: "identified" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "spectral.decision" } });
    expect(audit.entityId).toBe(id);
    expect(audit.after).toMatchObject({
      kind: "spectral",
      analysisId,
      decision,
      polymer: retained,
      hasNote: !!note,
    });
    expect(JSON.stringify(audit.after)).not.toContain("secret-note");
    const a = await prisma.modelPrediction.findUniqueOrThrow({ where: { id: analysisId } });
    expect(a.status).toBe("proposed");
  });

  it("corrigée en OTHER avec note", async () => {
    const analysisId = await analysis();
    await recordSpectralDecision(researcher, studyId, analysisId, {
      decision: "corrected",
      polymer: "OTHER",
      note: "x",
    });
    expect(await prisma.modelPrediction.count({ where: { status: "corrected" } })).toBe(1);
  });

  describe("refus sans écriture", () => {
    async function refused(
      d: Parameters<typeof recordSpectralDecision>[3],
      message: string,
      opts: { abstained?: boolean; ctx?: LabContext } = {},
    ) {
      const analysisId = await analysis(opts.abstained);
      const before = await counts();
      await expect(
        recordSpectralDecision(opts.ctx ?? researcher, studyId, analysisId, d),
      ).rejects.toThrow(message);
      expect(await counts()).toEqual(before);
    }
    it("décision inconnue", () => refused({ decision: "autre" }, "Décision inconnue."));
    it("accepter une abstention", () =>
      refused({ decision: "accepted" }, "Aucune proposition à accepter : corrigez ou rejetez.", {
        abstained: true,
      }));
    it("correction sans polymère", () =>
      refused({ decision: "corrected" }, "Choisissez le polymère retenu."));
    it("polymère inconnu", () =>
      refused({ decision: "corrected", polymer: "XYZ" }, "Polymère inconnu."));
    it("polymère égal à la proposition", () =>
      refused(
        { decision: "corrected", polymer: "PE" },
        "Le polymère choisi est celui proposé : choisissez « Acceptée ».",
      ));
    it("rejet sans note", () =>
      refused({ decision: "rejected" }, "Une note est obligatoire pour rejeter une proposition."));
    it("OTHER sans note", () =>
      refused(
        { decision: "corrected", polymer: "OTHER" },
        "Une note est obligatoire pour « Autre polymère » ou « Non plastique ».",
      ));
    it("NOT_PLASTIC sans note", () =>
      refused(
        { decision: "corrected", polymer: "NOT_PLASTIC", note: "  " },
        "Une note est obligatoire pour « Autre polymère » ou « Non plastique ».",
      ));
    it("note de 1 001 caractères", () =>
      refused(
        { decision: "rejected", note: "x".repeat(1001) },
        "La note dépasse 1 000 caractères.",
      ));
    it("analyse d'une autre étude du laboratoire", async () => {
      const analysisId = await analysis();
      const before = await counts();
      await expect(
        recordSpectralDecision(researcher, sameLabStudyId, analysisId, { decision: "accepted" }),
      ).rejects.toThrow("Analyse introuvable.");
      expect(await counts()).toEqual(before);
    });
    it("identifiant d'une décision", async () => {
      const analysisId = await analysis();
      const { id } = await recordSpectralDecision(researcher, studyId, analysisId, { decision: "accepted" });
      const before = await counts();
      await expect(
        recordSpectralDecision(researcher, studyId, id, { decision: "accepted" }),
      ).rejects.toThrow("Analyse introuvable.");
      expect(await counts()).toEqual(before);
    });
    it("étude archivée", async () => {
      const analysisId = await analysis();
      await archiveStudy(researcher, studyId, "fin");
      const before = await counts();
      await expect(
        recordSpectralDecision(researcher, studyId, analysisId, { decision: "accepted" }),
      ).rejects.toThrow("Étude archivée : lecture seule.");
      expect(await counts()).toEqual(before);
    });
    it("viewer", () =>
      refused({ decision: "accepted" }, "Action réservée aux chercheurs du laboratoire.", {
        ctx: viewer,
      }));
  });
});

describe("lecture", () => {
  it("deux analyses, la plus récente d'abord ; décision la plus récente et compte", async () => {
    const a1 = (await analyzeSpectrum(researcher, studyId, input())).id;
    const a2 = (
      await analyzeSpectrum(
        researcher,
        studyId,
        input({ bytes: OTHER_BYTES as Uint8Array<ArrayBuffer> }),
      )
    ).id;
    let list = await listSpectralAnalyses(viewer, studyId);
    expect(list.hidden).toBe(0);
    expect(list.rows.map((r) => r.id)).toEqual([a2, a1]);
    expect(list.rows[0]).toMatchObject({
      fileName: "mon-spectre-secret.txt",
      techniqueLabel: "Raman",
      status: "identified",
      statusLabel: "Identifié (proposition)",
      proposedLabel: "Polyéthylène (PE)",
      modelVersion: "s1",
      decision: null,
    });
    await recordSpectralDecision(researcher, studyId, a1, { decision: "accepted" });
    await recordSpectralDecision(researcher, studyId, a1, { decision: "corrected", polymer: "PP" });
    list = await listSpectralAnalyses(viewer, studyId);
    const row = list.rows.find((r) => r.id === a1)!;
    expect(row.decision).toMatchObject({
      decision: "corrected",
      polymer: "PP",
      polymerLabel: "Polypropylène (PP)",
      decidedBy: "Rita",
      count: 2,
    });
    const view = await getSpectralAnalysis(viewer, studyId, a1);
    expect(view).toMatchObject({
      id: a1,
      createdBy: "Rita",
      sizeBytes: BYTES.length,
      inputSha256: sha(BYTES),
      technique: "raman",
      xUnit: "nm",
      yUnit: "intensity",
      laserNm: 532,
      modelName: "c5-spectral",
      modelSha256: MODEL_SHA,
      archived: false,
    });
    expect(view?.output).toEqual(IDENTIFIED(BYTES));
    expect(view?.decision?.decision).toBe("corrected");
  });

  it("deux décisions dans la même milliseconde : createdAt strictement croissants", async () => {
    const a = (await analyzeSpectrum(researcher, studyId, input())).id;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 60_000));
    await recordSpectralDecision(researcher, studyId, a, { decision: "accepted" });
    await recordSpectralDecision(researcher, studyId, a, { decision: "corrected", polymer: "PP" });
    await recordSpectralDecision(researcher, studyId, a, { decision: "rejected", note: "n" });
    vi.useRealTimers();
    const rows = await prisma.modelPrediction.findMany({
      where: { status: { not: "proposed" } },
      orderBy: { createdAt: "asc" },
    });
    const times = rows.map((r) => r.createdAt.getTime());
    expect(times[1]).toBeGreaterThan(times[0]);
    expect(times[2]).toBeGreaterThan(times[1]);
    expect(rows.map((r) => r.status)).toEqual(["accepted", "corrected", "rejected"]);
    const list = await listSpectralAnalyses(viewer, studyId);
    expect(list.rows[0].decision?.decision).toBe("rejected");
  });

  it("autre laboratoire : null / étude introuvable", async () => {
    const a = (await analyzeSpectrum(researcher, studyId, input())).id;
    expect(await getSpectralAnalysis(other, studyId, a)).toBeNull();
    expect(await getSpectralAnalysis(viewer, studyId, "inconnue")).toBeNull();
    await expect(listSpectralAnalyses(other, studyId)).rejects.toThrow("Étude introuvable.");
  });
});

describe("getSpectralModel", () => {
  const info = (available: boolean) =>
    ({ available, name: "c5-spectral" }) as unknown as SpectralModelInfo;
  it("disponible", async () => {
    model.mockResolvedValue(info(true));
    expect(await getSpectralModel(viewer)).toMatchObject({ kind: "ok" });
  });
  it("indisponible", async () => {
    model.mockResolvedValue(info(false));
    expect(await getSpectralModel(viewer)).toMatchObject({ kind: "unavailable" });
  });
  it("moteur injoignable", async () => {
    model.mockRejectedValue(new EngineUnavailableError());
    expect(await getSpectralModel(viewer)).toEqual({ kind: "engine_down" });
  });
});

/** Lance `run`, la laisse attendre le verrou de l'étude, archive l'étude sous ce verrou, puis rend l'erreur. */
async function archiveWhileWaiting(sid: string, run: () => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const lockedP = new Promise<void>((r) => (locked = r));
  const holder = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Study" WHERE id = ${sid} FOR UPDATE`;
    locked();
    await gate;
    await tx.study.update({ where: { id: sid }, data: { archivedAt: new Date() } });
  });
  await lockedP;
  const attempt = run().then(
    () => null,
    (e: unknown) => e,
  );
  await new Promise((r) => setTimeout(r, 600));
  release();
  await holder;
  return attempt;
}

describe("cas limites", () => {
  it("analyse : étude archivée pendant l'attente du verrou, aucune écriture", async () => {
    const before = await prisma.modelPrediction.count();
    const error = await archiveWhileWaiting(studyId, () => analyzeSpectrum(researcher, studyId, input()));
    expect((error as Error).message).toBe("Étude archivée : lecture seule.");
    expect(await prisma.modelPrediction.count()).toBe(before);
    expect(await prisma.auditEvent.count({ where: { action: "spectral.analysis" } })).toBe(0);
  });

  it("décision : étude archivée pendant l'attente du verrou, aucune écriture", async () => {
    const a = (await analyzeSpectrum(researcher, studyId, input())).id;
    const before = await prisma.modelPrediction.count();
    const error = await archiveWhileWaiting(studyId, () =>
      recordSpectralDecision(researcher, studyId, a, { decision: "accepted" }),
    );
    expect((error as Error).message).toBe("Étude archivée : lecture seule.");
    expect(await prisma.modelPrediction.count()).toBe(before);
  });

  it("un nouvel envoi identique restaure le fichier absent du magasin", async () => {
    const first = await analyzeSpectrum(researcher, studyId, input());
    rmSync(path.join(dir, "files"), { recursive: true, force: true });
    const second = await analyzeSpectrum(researcher, studyId, input());
    expect(second).toEqual({ id: first.id, existing: true });
    expect(existsSync(path.join(dir, "files", sha(BYTES)))).toBe(true);
  });

  it("l'auteur de l'analyse est lu dans createdById, pas dans l'audit", async () => {
    const { id } = await analyzeSpectrum(researcher, studyId, input());
    await prisma.modelPrediction.update({ where: { id }, data: { createdById: viewer.userId } });
    expect((await getSpectralAnalysis(viewer, studyId, id))?.createdBy).toBe("Vera");
  });

  it("invariant : chaque analyse a exactement un événement spectral.analysis, au même acteur", async () => {
    await analyzeSpectrum(researcher, studyId, input());
    await analyzeSpectrum(researcher, studyId, input({ laserNm: "785" }));
    await analyzeSpectrum(researcher, studyId, input());
    const analyses = await prisma.modelPrediction.findMany({ where: { kind: "spectral", status: "proposed" } });
    expect(analyses).toHaveLength(2);
    for (const a of analyses) {
      const events = await prisma.auditEvent.findMany({
        where: { action: "spectral.analysis", entityType: "ModelPrediction", entityId: a.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0].actorId).toBe(researcher.userId);
      expect(a.createdById).toBe(events[0].actorId);
    }
  });
});
