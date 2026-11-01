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
      imageModel: vi.fn(),
      analyzeImage: vi.fn(),
      validateImage: vi.fn(),
    },
  };
});

const dir = mkdtempSync(path.join(tmpdir(), "mt-images-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

import { prisma } from "@/server/db";
import { EngineError, EngineUnavailableError, engineClient } from "@/server/engine/client";
import {
  analyzeImage,
  buildCountsCsv,
  buildParticlesCsv,
  getImageAnalysis,
  getImageModel,
  listImageAnalyses,
  listValidatedCounts,
  readAnalysisImage,
  recordImageDecision,
} from "@/server/images";
import type { LabContext } from "@/server/lab-context";
import { createProject } from "@/server/projects";
import { archiveStudy, createStudy } from "@/server/studies";
import { resetDb } from "../../../test/db-reset";
import {
  ANNOTATED_SHA,
  DISPLAY_SHA,
  MODEL_INFO,
  VALIDATED,
  proposalFor,
  unreliableFor,
} from "../../../test/images";
import { makeLab, makeMember } from "../../../test/labs";

const analyze = vi.mocked(engineClient.analyzeImage);
const validate = vi.mocked(engineClient.validateImage);
const modelInfo = vi.mocked(engineClient.imageModel);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const BYTES = new TextEncoder().encode("faux-fichier-image-secret");
const OTHER_BYTES = new TextEncoder().encode("autre-fichier-image");
const input = (over: Partial<Parameters<typeof analyzeImage>[2]> = {}) => ({
  fileName: "photo-de-madame-dupont.tif",
  mimeType: "image/tiff",
  bytes: BYTES as Uint8Array<ArrayBuffer>,
  scaleUmPerPx: "0.5" as string | null,
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
  analyze.mockReset();
  validate.mockReset();
  modelInfo.mockReset();
  analyze.mockImplementation(async (a) => proposalFor(a.file.data as Uint8Array));
  validate.mockResolvedValue(VALIDATED);
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

const storeNames = () =>
  existsSync(path.join(dir, "files")) ? readdirSync(path.join(dir, "files")).sort() : [];
async function counts() {
  return [await prisma.modelPrediction.count(), await prisma.auditEvent.count(), storeNames().length];
}

describe("getImageModel", () => {
  it("ok, indisponible, moteur injoignable", async () => {
    modelInfo.mockResolvedValueOnce(MODEL_INFO);
    expect(await getImageModel(viewer)).toMatchObject({ kind: "ok" });
    modelInfo.mockResolvedValueOnce({ ...MODEL_INFO, available: false });
    expect(await getImageModel(viewer)).toMatchObject({ kind: "unavailable" });
    modelInfo.mockRejectedValueOnce(new EngineUnavailableError());
    expect(await getImageModel(viewer)).toEqual({ kind: "engine_down" });
  });
});

describe("analyzeImage", () => {
  it("écrit l'analyse, les deux PNG du moteur (jamais le fichier déposé) et l'audit", async () => {
    const { id, existing } = await analyzeImage(researcher, studyId, input());
    expect(existing).toBe(false);
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      kind: "image",
      status: "proposed",
      inputFileSha256: sha(BYTES),
      modelName: "c6-microscopie",
      modelVersion: "i1",
      decidedById: null,
      decisionNote: null,
      createdById: researcher.userId,
    });
    const expectedScore =
      proposalFor(BYTES).particles.reduce((s, p) => s + p.shape_score, 0) / 5;
    expect(row.score).toBeCloseTo(expectedScore, 10);
    expect(row.input).toEqual({
      role: "analysis",
      fileName: "photo-de-madame-dupont.tif",
      sizeBytes: BYTES.length,
      mimeType: "image/tiff",
      scaleEntered: "0.5",
      displaySha256: DISPLAY_SHA,
      annotatedSha256: ANNOTATED_SHA,
    });
    const { images, ...rest } = proposalFor(BYTES);
    expect(images).toBeDefined();
    expect(row.output).toEqual(rest);
    expect(Object.keys(row.output as object)).not.toContain("images");
    // Le magasin ne contient que les deux PNG du moteur.
    expect(storeNames()).toEqual([DISPLAY_SHA, ANNOTATED_SHA].sort());
    expect(storeNames()).not.toContain(sha(BYTES));
    const audit = await prisma.auditEvent.findMany({ where: { action: "image.analysis" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: "ModelPrediction", entityId: id, actorId: researcher.userId });
    const after = audit[0].after as Record<string, unknown>;
    expect(Object.keys(after).sort()).toEqual([
      "count",
      "inputSha256",
      "kind",
      "modelVersion",
      "scaleSource",
      "status",
      "studyId",
    ]);
    expect(after).toMatchObject({ kind: "image", status: "proposal", count: 5, scaleSource: "entered" });
    expect(JSON.stringify(after)).not.toContain("dupont");
    expect(analyze).toHaveBeenCalledWith({
      file: { data: BYTES, filename: "image" },
      scaleUmPerPx: "0.5",
    });
  });

  it("virgule décimale normalisée, échelle vide = sans échelle", async () => {
    await analyzeImage(researcher, studyId, input({ scaleUmPerPx: "0,25" }));
    expect(analyze).toHaveBeenLastCalledWith(expect.objectContaining({ scaleUmPerPx: "0.25" }));
    await analyzeImage(researcher, studyId, input({ scaleUmPerPx: "  " }));
    expect(analyze).toHaveBeenLastCalledWith(expect.objectContaining({ scaleUmPerPx: null }));
  });

  it("abstention : score null, statut non fiable dans l'audit", async () => {
    analyze.mockImplementation(async (a) => unreliableFor(a.file.data as Uint8Array));
    const { id } = await analyzeImage(researcher, studyId, input({ scaleUmPerPx: null }));
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect(row.score).toBeNull();
    const a = await prisma.auditEvent.findFirstOrThrow({ where: { action: "image.analysis" } });
    expect(a.after).toMatchObject({ status: "unreliable", count: 0, scaleSource: "none" });
  });

  it("idempotence : même dépôt deux fois, une seule analyse et un seul audit", async () => {
    const first = await analyzeImage(researcher, studyId, input());
    const second = await analyzeImage(researcher, studyId, input());
    expect(second).toEqual({ id: first.id, existing: true });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(await prisma.modelPrediction.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "image.analysis" } })).toBe(1);
  });

  it("une autre échelle ou un autre fichier donnent une nouvelle analyse", async () => {
    await analyzeImage(researcher, studyId, input());
    const b = await analyzeImage(researcher, studyId, input({ scaleUmPerPx: "1" }));
    const c = await analyzeImage(
      researcher,
      studyId,
      input({ bytes: OTHER_BYTES as Uint8Array<ArrayBuffer> }),
    );
    expect(b.existing).toBe(false);
    expect(c.existing).toBe(false);
    expect(await prisma.modelPrediction.count()).toBe(3);
  });

  it("deux dépôts simultanés : une seule analyse", async () => {
    const [a, b] = await Promise.all([
      analyzeImage(researcher, studyId, input()),
      analyzeImage(researcher, studyId, input()),
    ]);
    expect(a.id).toBe(b.id);
    expect(await prisma.modelPrediction.count()).toBe(1);
  });

  it("le moteur qui renvoie autre chose qu'un PNG : refus sans écriture", async () => {
    analyze.mockImplementation(async (a) => {
      const r = proposalFor(a.file.data as Uint8Array);
      r.images.display_png_base64 = Buffer.from("pas un png").toString("base64");
      return r;
    });
    const before = await counts();
    await expect(analyzeImage(researcher, studyId, input())).rejects.toThrow(
      "Le moteur d'analyse n'a pas pu analyser cette image.",
    );
    expect(await counts()).toEqual(before);
  });

  describe("refus sans écriture", () => {
    async function refused(c: LabContext, sid: string, i: ReturnType<typeof input>, message: string) {
      const before = await counts();
      await expect(analyzeImage(c, sid, i)).rejects.toThrow(message);
      expect(await counts()).toEqual(before);
    }
    it("viewer", async () => {
      await refused(viewer, studyId, input(), "Action réservée aux chercheurs du laboratoire.");
      expect(analyze).not.toHaveBeenCalled();
    });
    it("étude archivée", async () => {
      await archiveStudy(researcher, studyId, "fin");
      await refused(researcher, studyId, input(), "Étude archivée : lecture seule.");
      expect(analyze).not.toHaveBeenCalled();
    });
    it("étude d'un autre laboratoire", async () => {
      await refused(researcher, otherStudyId, input(), "Étude introuvable.");
      expect(analyze).not.toHaveBeenCalled();
    });
    it("fichier vide", async () => {
      await refused(
        researcher,
        studyId,
        input({ bytes: new Uint8Array(0) as Uint8Array<ArrayBuffer> }),
        "Aucun fichier reçu.",
      );
    });
    it("25 Mio + 1", async () => {
      const big = new Uint8Array(25 * 1024 * 1024 + 1) as Uint8Array<ArrayBuffer>;
      await refused(researcher, studyId, input({ bytes: big }), "Fichier trop volumineux (25 Mo maximum).");
      expect(analyze).not.toHaveBeenCalled();
    });
    it.each(["1e3", "abc", "-1", "1,2,3", "12345", "0.1234567"])("échelle %s", async (scale) => {
      await refused(researcher, studyId, input({ scaleUmPerPx: scale }), "Échelle invalide.");
      expect(analyze).not.toHaveBeenCalled();
    });
    it("422 du moteur transmis", async () => {
      analyze.mockRejectedValue(new EngineError(422, "Image illisible ou tronquée."));
      await refused(researcher, studyId, input(), "Image illisible ou tronquée.");
    });
    it("503 : modèle indisponible", async () => {
      analyze.mockRejectedValue(new EngineError(503, "détail du moteur"));
      await refused(
        researcher,
        studyId,
        input(),
        "Le modèle d'images est indisponible : aucune analyse n'est possible pour l'instant.",
      );
    });
    it("autre erreur du moteur", async () => {
      analyze.mockRejectedValue(new EngineError(500, "boum"));
      await refused(researcher, studyId, input(), "Le moteur d'analyse n'a pas pu analyser cette image.");
    });
    it("sha256 différent", async () => {
      analyze.mockImplementation(async () => proposalFor(OTHER_BYTES));
      await refused(
        researcher,
        studyId,
        input(),
        "Le moteur n'a pas analysé le fichier déposé : recommencez.",
      );
    });
    it("moteur injoignable : erreur relancée", async () => {
      analyze.mockRejectedValue(new EngineUnavailableError());
      const before = await counts();
      await expect(analyzeImage(researcher, studyId, input())).rejects.toBeInstanceOf(
        EngineUnavailableError,
      );
      expect(await counts()).toEqual(before);
    });
  });
});

describe("recordImageDecision", () => {
  async function analysis(unreliable = false, sid = studyId) {
    if (unreliable) analyze.mockImplementation(async (a) => unreliableFor(a.file.data as Uint8Array));
    return (await analyzeImage(researcher, sid, input())).id;
  }

  it("acceptée : le moteur reçoit les particules enregistrées, le comptage validé est stocké", async () => {
    const analysisId = await analysis();
    const { id } = await recordImageDecision(researcher, studyId, analysisId, { decision: "accepted" });
    const stored = proposalFor(BYTES);
    expect(validate).toHaveBeenCalledWith({
      analysis: { particles: stored.particles, scale: stored.scale, count: 5 },
      excluded: [],
      reshaped: [],
      missed_count: 0,
    });
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      kind: "image",
      status: "accepted",
      inputFileSha256: sha(BYTES),
      modelName: "c6-microscopie",
      modelVersion: "i1",
      decidedById: researcher.userId,
      decisionNote: null,
      createdById: null,
    });
    expect(row.decidedAt).not.toBeNull();
    expect(row.input).toEqual({
      role: "decision",
      analysisId,
      decision: "accepted",
      excluded: [],
      reshaped: [],
      missedCount: 0,
    });
    expect(row.output).toEqual({
      analysisId,
      proposedStatus: "proposal",
      proposedCount: 5,
      validated: VALIDATED,
    });
  });

  it("corrigée : exclusion, particule manquée, changement de forme ; statut et corrections stockés", async () => {
    const analysisId = await analysis();
    const { id } = await recordImageDecision(researcher, studyId, analysisId, {
      decision: "corrected",
      excluded: [2],
      reshaped: [{ id: 1, shape: "bille" }],
      missed: 1,
      note: "Fibre vue au microscope optique",
    });
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        excluded: [2],
        reshaped: [{ id: 1, shape: "bille" }],
        missed_count: 1,
      }),
    );
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("corrected");
    expect(row.input).toEqual({
      role: "decision",
      analysisId,
      decision: "corrected",
      excluded: [2],
      reshaped: [{ id: 1, shape: "bille" }],
      missedCount: 1,
    });
    expect(row.decisionNote).toBe("Fibre vue au microscope optique");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "image.decision" } });
    expect(audit.after).toEqual({
      kind: "image",
      studyId,
      analysisId,
      decision: "corrected",
      proposedCount: 5,
      validatedCount: 5,
      excluded: [2],
      reshaped: [{ id: 1, shape: "bille" }],
      missed: 1,
      modelVersion: "i1",
      hasNote: true,
    });
    expect(JSON.stringify(audit.after)).not.toContain("microscope");
  });

  it("une forme identique à la proposée ne compte pas comme correction", async () => {
    const analysisId = await analysis();
    await expect(
      recordImageDecision(researcher, studyId, analysisId, {
        decision: "corrected",
        reshaped: [{ id: 1, shape: "fibre" }],
      }),
    ).rejects.toThrow("Aucune correction saisie");
    // La forme « incertaine » reformée en fibre est un vrai changement.
    await recordImageDecision(researcher, studyId, analysisId, {
      decision: "corrected",
      reshaped: [{ id: 5, shape: "fibre" }],
    });
  });

  it("une forme identique à la proposée est retirée avant le stockage et l'audit", async () => {
    const analysisId = await analysis();
    const { id } = await recordImageDecision(researcher, studyId, analysisId, {
      decision: "corrected",
      excluded: [2],
      reshaped: [
        { id: 1, shape: "fibre" },
        { id: 5, shape: "bille" },
      ],
    });
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({ reshaped: [{ id: 5, shape: "bille" }] }),
    );
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect((row.input as { reshaped: unknown }).reshaped).toEqual([{ id: 5, shape: "bille" }]);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "image.decision" } });
    expect((audit.after as { reshaped: unknown }).reshaped).toEqual([{ id: 5, shape: "bille" }]);
    // Une acceptation qui ne porte qu'une forme identique n'a pas de correction.
    await recordImageDecision(researcher, studyId, analysisId, {
      decision: "accepted",
      reshaped: [{ id: 1, shape: "fibre" }],
    });
  });

  it("rejetée : note obligatoire, comptage validé null, moteur non appelé", async () => {
    const analysisId = await analysis();
    const { id } = await recordImageDecision(researcher, studyId, analysisId, {
      decision: "rejected",
      note: "Image floue, secret-note",
    });
    expect(validate).not.toHaveBeenCalled();
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("rejected");
    expect(row.output).toMatchObject({ validated: null, proposedCount: 5 });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "image.decision" } });
    expect(audit.after).toMatchObject({ decision: "rejected", validatedCount: null, hasNote: true });
    expect(JSON.stringify(audit.after)).not.toContain("secret-note");
  });

  it("rejetée sur une abstention, corrigée sur une abstention (particule ajoutée)", async () => {
    const analysisId = await analysis(true);
    await recordImageDecision(researcher, studyId, analysisId, { decision: "corrected", missed: 3 });
    await recordImageDecision(researcher, studyId, analysisId, { decision: "rejected", note: "n" });
  });

  describe("refus (messages exacts), sans écriture ni appel superflu au moteur", () => {
    async function refused(
      c: LabContext,
      sid: string,
      aid: string,
      i: Parameters<typeof recordImageDecision>[3],
      message: string,
    ) {
      const before = await counts();
      await expect(recordImageDecision(c, sid, aid, i)).rejects.toThrow(message);
      expect(await counts()).toEqual(before);
    }
    it("décision inconnue", async () => {
      const a = await analysis();
      await refused(researcher, studyId, a, { decision: "peut-être" }, "Décision inconnue.");
    });
    it("acceptée sur une abstention", async () => {
      const a = await analysis(true);
      await refused(
        researcher,
        studyId,
        a,
        { decision: "accepted" },
        "Aucune proposition à accepter : corrigez ou rejetez.",
      );
      expect(validate).not.toHaveBeenCalled();
    });
    it.each([
      [{ excluded: [1] }],
      [{ reshaped: [{ id: 1, shape: "bille" }] }],
      [{ missed: 2 }],
    ])("acceptée avec des corrections %j", async (corrections) => {
      const a = await analysis();
      await refused(
        researcher,
        studyId,
        a,
        { decision: "accepted", ...corrections },
        "Une acceptation ne porte pas de correction : choisissez « Corrigée ».",
      );
      expect(validate).not.toHaveBeenCalled();
    });
    it("corrigée sans correction", async () => {
      const a = await analysis();
      await refused(
        researcher,
        studyId,
        a,
        { decision: "corrected" },
        "Aucune correction saisie : choisissez « Acceptée » ou modifiez au moins une particule.",
      );
      expect(validate).not.toHaveBeenCalled();
    });
    it("rejetée sans note (ou note d'espaces)", async () => {
      const a = await analysis();
      await refused(
        researcher,
        studyId,
        a,
        { decision: "rejected", note: "   " },
        "Une note est obligatoire pour rejeter une proposition.",
      );
    });
    it("rejetée avec des corrections", async () => {
      const a = await analysis();
      await refused(
        researcher,
        studyId,
        a,
        { decision: "rejected", note: "n", excluded: [1] },
        "Une proposition rejetée ne porte pas de correction.",
      );
    });
    it("identifiant non entier", async () => {
      const a = await analysis();
      await refused(
        researcher,
        studyId,
        a,
        { decision: "corrected", excluded: [1.5] },
        "Corrections invalides.",
      );
      await refused(
        researcher,
        studyId,
        a,
        { decision: "corrected", excluded: ["1"] as unknown as number[] },
        "Corrections invalides.",
      );
      expect(validate).not.toHaveBeenCalled();
    });
    it("301 identifiants", async () => {
      const a = await analysis();
      await refused(
        researcher,
        studyId,
        a,
        { decision: "corrected", excluded: Array.from({ length: 301 }, (_, i) => i + 1) },
        "Corrections invalides.",
      );
    });
    it("identifiant en double, particules manquées hors limites", async () => {
      const a = await analysis();
      await refused(researcher, studyId, a, { decision: "corrected", excluded: [1, 1] }, "Corrections invalides.");
      await refused(
        researcher,
        studyId,
        a,
        { decision: "corrected", excluded: [1], reshaped: [{ id: 1, shape: "fibre" }] },
        "Corrections invalides.",
      );
      await refused(researcher, studyId, a, { decision: "corrected", missed: 10_001 }, "Corrections invalides.");
      await refused(researcher, studyId, a, { decision: "corrected", missed: -1 }, "Corrections invalides.");
    });
    it("422 du moteur (identifiant inconnu)", async () => {
      const a = await analysis();
      validate.mockRejectedValue(new EngineError(422, "Particule 9 inconnue."));
      await refused(researcher, studyId, a, { decision: "corrected", excluded: [9] }, "Particule 9 inconnue.");
    });
    it("autre erreur du moteur", async () => {
      const a = await analysis();
      validate.mockRejectedValue(new EngineError(500, "boum"));
      await refused(
        researcher,
        studyId,
        a,
        { decision: "accepted" },
        "Le moteur d'analyse n'a pas pu valider cette analyse.",
      );
    });
    it("moteur injoignable : rien n'est écrit", async () => {
      const a = await analysis();
      validate.mockRejectedValue(new EngineUnavailableError());
      const before = await counts();
      await expect(
        recordImageDecision(researcher, studyId, a, { decision: "accepted" }),
      ).rejects.toBeInstanceOf(EngineUnavailableError);
      expect(await counts()).toEqual(before);
    });
    it("note de 1 001 caractères", async () => {
      const a = await analysis();
      await refused(
        researcher,
        studyId,
        a,
        { decision: "rejected", note: "x".repeat(1001) },
        "La note dépasse 1 000 caractères.",
      );
    });
    it("analyse d'une autre étude ou inconnue", async () => {
      const a = await analysis();
      await refused(researcher, sameLabStudyId, a, { decision: "accepted" }, "Analyse introuvable.");
      await refused(researcher, studyId, "inconnue", { decision: "accepted" }, "Analyse introuvable.");
    });
    it("l'identifiant d'une décision n'est pas une analyse", async () => {
      const a = await analysis();
      const d = await recordImageDecision(researcher, studyId, a, { decision: "accepted" });
      await refused(researcher, studyId, d.id, { decision: "accepted" }, "Analyse introuvable.");
    });
    it("étude archivée", async () => {
      const a = await analysis();
      await archiveStudy(researcher, studyId, "fin");
      await refused(researcher, studyId, a, { decision: "accepted" }, "Étude archivée : lecture seule.");
      expect(validate).not.toHaveBeenCalled();
    });
    it("viewer", async () => {
      const a = await analysis();
      await refused(viewer, studyId, a, { decision: "accepted" }, "Action réservée aux chercheurs du laboratoire.");
    });
    it("autre laboratoire", async () => {
      const a = await analysis();
      await refused(other, studyId, a, { decision: "accepted" }, "Étude introuvable.");
      await refused(other, otherStudyId, a, { decision: "accepted" }, "Analyse introuvable.");
    });
  });
});

describe("lecture", () => {
  it("plus récente d'abord, dernière décision et nombre de décisions", async () => {
    const first = (await analyzeImage(researcher, studyId, input())).id;
    const second = (
      await analyzeImage(researcher, studyId, input({ bytes: OTHER_BYTES as Uint8Array<ArrayBuffer> }))
    ).id;
    await recordImageDecision(researcher, studyId, first, { decision: "accepted" });
    await recordImageDecision(researcher, studyId, first, {
      decision: "corrected",
      excluded: [2],
      missed: 1,
    });
    const list = await listImageAnalyses(viewer, studyId);
    expect(list.hidden).toBe(0);
    expect(list.rows.map((r) => r.id)).toEqual([second, first]);
    expect(list.rows[0]).toMatchObject({
      fileName: "photo-de-madame-dupont.tif",
      status: "proposal",
      statusLabel: "Proposition",
      count: 5,
      scaleSource: "entered",
      scaleSourceLabel: "saisie",
      modelVersion: "i1",
      decision: null,
    });
    expect(list.rows[1].decision).toMatchObject({
      decision: "corrected",
      count: 2,
      excluded: [2],
      missed: 1,
      reshaped: [],
      decidedBy: "Rita",
      validated: VALIDATED,
    });
  });

  it("createdAt des décisions strictement croissants à horloge figée", async () => {
    const a = (await analyzeImage(researcher, studyId, input())).id;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 60_000));
    await recordImageDecision(researcher, studyId, a, { decision: "accepted" });
    await recordImageDecision(researcher, studyId, a, { decision: "corrected", missed: 1 });
    await recordImageDecision(researcher, studyId, a, { decision: "rejected", note: "n" });
    vi.useRealTimers();
    const rows = await prisma.modelPrediction.findMany({
      where: { status: { not: "proposed" } },
      orderBy: { createdAt: "asc" },
    });
    const times = rows.map((r) => r.createdAt.getTime());
    expect(times[1]).toBeGreaterThan(times[0]);
    expect(times[2]).toBeGreaterThan(times[1]);
    expect(rows.map((r) => r.status)).toEqual(["accepted", "corrected", "rejected"]);
    expect((await listImageAnalyses(viewer, studyId)).rows[0].decision?.decision).toBe("rejected");
  });

  it("listValidatedCounts ne garde que les dernières décisions acceptées ou corrigées", async () => {
    const a = (await analyzeImage(researcher, studyId, input())).id; // acceptée
    const b = (
      await analyzeImage(researcher, studyId, input({ bytes: OTHER_BYTES as Uint8Array<ArrayBuffer> }))
    ).id; // acceptée puis rejetée
    const c = (await analyzeImage(researcher, studyId, input({ scaleUmPerPx: "2" }))).id; // corrigée
    await analyzeImage(researcher, studyId, input({ scaleUmPerPx: "3" })); // sans décision
    await recordImageDecision(researcher, studyId, a, { decision: "accepted" });
    await recordImageDecision(researcher, studyId, b, { decision: "accepted" });
    await recordImageDecision(researcher, studyId, b, { decision: "rejected", note: "n" });
    await recordImageDecision(researcher, studyId, c, { decision: "corrected", excluded: [1] });
    const rows = await listValidatedCounts(viewer, studyId);
    expect(rows.map((r) => [r.analysisId, r.decision])).toEqual([
      [c, "corrected"],
      [a, "accepted"],
    ]);
    expect(rows[0]).toMatchObject({ validated: VALIDATED, medianFeretUm: 11.5 });
    await expect(listValidatedCounts(other, studyId)).rejects.toThrow("Étude introuvable.");
  });

  it("getImageAnalysis : vue complète, autre laboratoire ou étude : null", async () => {
    const a = (await analyzeImage(researcher, studyId, input())).id;
    const view = await getImageAnalysis(viewer, studyId, a);
    expect(view).toMatchObject({
      id: a,
      createdBy: "Rita",
      sizeBytes: BYTES.length,
      inputSha256: sha(BYTES),
      scaleEntered: "0.5",
      modelName: "c6-microscopie",
      archived: false,
    });
    const { images, ...rest } = proposalFor(BYTES);
    expect(images).toBeDefined();
    expect(view?.output).toEqual(rest);
    expect(await getImageAnalysis(other, studyId, a)).toBeNull();
    expect(await getImageAnalysis(other, otherStudyId, a)).toBeNull();
    expect(await getImageAnalysis(researcher, sameLabStudyId, a)).toBeNull();
    expect(await getImageAnalysis(viewer, studyId, "inconnue")).toBeNull();
    await expect(listImageAnalyses(other, studyId)).rejects.toThrow("Étude introuvable.");
  });
});

describe("readAnalysisImage", () => {
  it("renvoie les octets du magasin ; null pour une analyse étrangère", async () => {
    const a = (await analyzeImage(researcher, studyId, input())).id;
    const display = await readAnalysisImage(viewer, studyId, a, "display");
    const annotated = await readAnalysisImage(viewer, studyId, a, "annotated");
    expect(display && sha(display)).toBe(DISPLAY_SHA);
    expect(annotated && sha(annotated)).toBe(ANNOTATED_SHA);
    expect(await readAnalysisImage(other, studyId, a, "display")).toBeNull();
    expect(await readAnalysisImage(other, otherStudyId, a, "display")).toBeNull();
    expect(await readAnalysisImage(viewer, sameLabStudyId, a, "display")).toBeNull();
  });

  it("un fichier modifié dans le magasin est refusé", async () => {
    const a = (await analyzeImage(researcher, studyId, input())).id;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(dir, "files", DISPLAY_SHA), "corrompu");
    await expect(readAnalysisImage(viewer, studyId, a, "display")).rejects.toThrow("corrompu");
  });
});

const COUNT_HEADER = [
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
const PARTICLE_HEADER = [
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
const lines = (body: string) => body.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("CSV", () => {
  it("comptages : colonnes du §9.3, une ligne par image validée, audit, aucun nom de fichier", async () => {
    const a = (await analyzeImage(researcher, studyId, input())).id;
    await analyzeImage(researcher, studyId, input({ scaleUmPerPx: "2" })); // non validée
    await recordImageDecision(researcher, studyId, a, { decision: "corrected", excluded: [2], missed: 1 });
    const file = await buildCountsCsv(viewer, studyId);
    expect(file.fileName).toMatch(/^microtrace-comptages-particules-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    const rows = lines(file.body).map((l) => l.split(";"));
    expect(rows[0]).toEqual(COUNT_HEADER);
    expect(rows).toHaveLength(2);
    const r = Object.fromEntries(COUNT_HEADER.map((h, i) => [h, rows[1][i]]));
    expect(r).toMatchObject({
      analysis_id: a,
      decision: "corrected",
      study_nature: "laboratory",
      image_sha256: sha(BYTES),
      scale_um_per_px: "0.5",
      scale_source: "entered",
      count_validated: "5",
      count_fibre: "1",
      count_fragment: "1",
      count_bille: "1",
      count_film: "0",
      count_unspecified: "2", // une forme incertaine + une particule manquée
      missed: "1",
      feret_median_um: "11.5",
      model_name: "c6-microscopie",
      model_version: "i1",
    });
    const shapes = ["fibre", "fragment", "bille", "film", "unspecified"].map((k) => Number(r[`count_${k}`]));
    expect(shapes.reduce((a, b) => a + b, 0)).toBe(Number(r.count_validated));
    expect(file.body).not.toContain("dupont");
    expect(file.body).not.toContain("fileName");
    expect(file.fileName).not.toContain("dupont");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "image.counts_export" } });
    expect(audit.after).toEqual({ studyId, rows: 1 });
    expect(audit.actorId).toBe(viewer.userId);
  });

  it("comptages sans image validée : en-tête seul", async () => {
    const file = await buildCountsCsv(viewer, studyId);
    expect(lines(file.body)).toEqual([COUNT_HEADER.join(";")]);
    await expect(buildCountsCsv(other, studyId)).rejects.toThrow("Étude introuvable.");
  });

  it("particules : 5 lignes, exclusion et forme retenue après correction", async () => {
    const a = (await analyzeImage(researcher, studyId, input())).id;
    const before = lines((await buildParticlesCsv(viewer, studyId, a)).body).map((l) => l.split(";"));
    expect(before[0]).toEqual(PARTICLE_HEADER);
    expect(before).toHaveLength(6);
    expect(before[1].slice(-2)).toEqual(["", ""]); // aucune décision : colonnes vides
    await recordImageDecision(researcher, studyId, a, {
      decision: "corrected",
      excluded: [2],
      reshaped: [{ id: 1, shape: "bille" }],
    });
    const file = await buildParticlesCsv(viewer, studyId, a);
    expect(file.fileName).toMatch(/^microtrace-particules-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.fileName).not.toContain("dupont");
    const rows = lines(file.body).map((l) => l.split(";"));
    expect(rows[0]).toEqual(PARTICLE_HEADER);
    expect(rows).toHaveLength(6);
    const by = (i: number) => Object.fromEntries(PARTICLE_HEADER.map((h, k) => [h, rows[i][k]]));
    expect(by(1)).toMatchObject({ particle_id: "1", shape: "fibre", validated_shape: "bille", excluded: "false" });
    expect(by(2)).toMatchObject({ particle_id: "2", validated_shape: "", excluded: "true" });
    expect(by(3)).toMatchObject({ particle_id: "3", validated_shape: "fragment", excluded: "false" });
    expect(by(5)).toMatchObject({ shape: "uncertain", shape_status: "uncertain" });
    // Une décision rejetée vide à nouveau les colonnes.
    await recordImageDecision(researcher, studyId, a, { decision: "rejected", note: "n" });
    const rejected = lines((await buildParticlesCsv(viewer, studyId, a)).body).map((l) => l.split(";"));
    expect(rejected[1].slice(-2)).toEqual(["", ""]);
  });

  it("particules : analyse étrangère ou inconnue", async () => {
    const a = (await analyzeImage(researcher, studyId, input())).id;
    await expect(buildParticlesCsv(other, studyId, a)).rejects.toThrow("Étude introuvable.");
    await expect(buildParticlesCsv(other, otherStudyId, a)).rejects.toThrow("Analyse introuvable.");
    await expect(buildParticlesCsv(viewer, sameLabStudyId, a)).rejects.toThrow("Analyse introuvable.");
  });
});
