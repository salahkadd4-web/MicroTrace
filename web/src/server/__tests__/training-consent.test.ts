import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return {
    ...actual,
    engineClient: { validateContext: vi.fn(async () => ({})), parseSpectrum: vi.fn() },
  };
});

const dir = mkdtempSync(path.join(tmpdir(), "mt-consent-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

import {
  EXPORT_COLUMNS,
  IMAGE_EXPORT_COLUMNS,
  TRAINING_CONSENT_DETAILS,
  TRAINING_CONSENT_VERSION,
} from "@/lib/training-consent";
import { prisma } from "@/server/db";
import { EngineError, engineClient } from "@/server/engine/client";
import * as fileStore from "@/server/file-store";
import { storeFile } from "@/server/file-store";
import type { LabContext } from "@/server/lab-context";
import { createProject } from "@/server/projects";
import { archiveStudy, createStudy, declarePseudonymisation } from "@/server/studies";
import {
  buildTrainingExport,
  getTrainingConsent,
  setTrainingConsent,
} from "@/server/training-consent";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const ADMIN_ONLY = "Action réservée aux responsables du laboratoire.";
const NO_EXPORT = "Consentement non donné : aucun export.";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const BYTES = (tag: string) => new TextEncoder().encode(`100 1\n200 2\n# ${tag}\n`);
const T0 = Date.UTC(2026, 9, 1);
const at = (n: number) => new Date(T0 + n * 60_000);

let admin: LabContext;
let researcher: LabContext;
let viewer: LabContext;
let adminB: LabContext;
let studyA1: string;
let studyA2: string;
let studyB: string;
let studySim: string;
let studyUndeclared: string;
const parse = vi.mocked(engineClient.parseSpectrum);

/** Simulacre du moteur : les deux colonnes numériques du fichier, sans le reste du texte. */
function fakeParse(file: { data: Blob | Uint8Array }) {
  const text = new TextDecoder().decode(file.data as Uint8Array);
  const x: number[] = [];
  const y: number[] = [];
  for (const line of text.split("\n")) {
    const m = /^(\d+) (\d+)$/.exec(line);
    if (m) {
      x.push(Number(m[1]));
      y.push(Number(m[2]));
    }
  }
  return { x, y };
}

async function newStudy(
  c: LabContext,
  title: string,
  opts: { nature?: "laboratory" | "simulated"; declared?: boolean } = {},
) {
  const p = await createProject(c, { title: `P ${title}` });
  const id = (
    await createStudy(c, p.id, {
      title,
      nature: opts.nature ?? "laboratory",
      blankCorrected: "unknown",
    })
  ).id;
  if (opts.declared !== false) await declarePseudonymisation(c, id);
  return id;
}

const analysisData = (studyId: string, digest: string, size: number, tag: string) => ({
  studyId,
  kind: "spectral" as const,
  inputFileSha256: digest,
  input: {
    role: "analysis",
    fileName: `nom-secret-${tag}.txt`,
    sizeBytes: size,
    technique: "raman",
    xUnit: "nm",
    yUnit: "intensity",
    laserNm: 532,
  },
  output: { status: "identified", candidates: [{ polymer: "PE" }] },
  score: 0.9,
  modelName: "c5-spectral",
  modelVersion: "s1",
  modelSha256: "d".repeat(64),
  createdAt: at(-100),
});

async function analysis(studyId: string, tag: string, opts: { store?: boolean } = {}) {
  const bytes = BYTES(tag);
  const digest = sha(bytes);
  if (opts.store !== false) await storeFile(digest, bytes);
  const row = await prisma.modelPrediction.create({
    data: analysisData(studyId, digest, bytes.length, tag),
  });
  return { id: row.id, bytes };
}

const decisionData = (
  studyId: string,
  analysisId: string,
  decision: "accepted" | "corrected" | "rejected",
  polymer: string | null,
  minutes: number,
) => ({
  studyId,
  kind: "spectral" as const,
  input: { role: "decision", analysisId, decision, polymer },
  output: { analysisId, proposedPolymer: "PE", proposedStatus: "identified" },
  score: 0.9,
  modelName: "c5-spectral",
  modelVersion: "s1",
  modelSha256: "d".repeat(64),
  status: decision,
  decidedById: researcher.userId,
  decidedAt: at(minutes),
  decisionNote: "note-secrete",
  createdAt: at(minutes),
});

const decide = (...args: Parameters<typeof decisionData>) =>
  prisma.modelPrediction.create({ data: decisionData(...args) });

async function seedDecisions() {
  const a1 = await analysis(studyA1, "a1");
  const a2 = await analysis(studyA1, "a2");
  const a3 = await analysis(studyA1, "a3");
  const a4 = await analysis(studyA1, "a4");
  const a5 = await analysis(studyA1, "a5");
  const a6 = await analysis(studyA1, "a6");
  const a7 = await analysis(studyA2, "a7");
  const b1 = await analysis(studyB, "b1");
  await decide(studyA1, a1.id, "accepted", "PE", 10);
  await decide(studyA1, a2.id, "corrected", "PP", 9);
  await decide(studyA1, a3.id, "rejected", null, 5);
  await decide(studyA1, a5.id, "accepted", "PE", 3);
  await decide(studyA1, a5.id, "rejected", null, 4);
  await decide(studyA1, a6.id, "rejected", null, 7);
  await decide(studyA1, a6.id, "corrected", "PS", 8);
  await decide(studyA2, a7.id, "accepted", "PE", 6);
  await decide(studyB, b1.id, "accepted", "PE", 11);
  // Exclues : étude simulée, étude sans déclaration de pseudonymisation.
  const sim = await analysis(studySim, "sim");
  await decide(studySim, sim.id, "accepted", "PE", 12);
  const undeclared = await analysis(studyUndeclared, "undeclared");
  await decide(studyUndeclared, undeclared.id, "accepted", "PE", 13);
  return { a1, a2, a3, a4, a5, a6, a7, b1, sim, undeclared };
}

beforeEach(async () => {
  await resetDb();
  const lab = await makeLab("Labo A", "labo-a");
  const labB = await makeLab("Labo B", "labo-b");
  admin = await makeMember(lab, "lab_admin", "ad@example.org", "Adèle");
  researcher = await makeMember(lab, "researcher", "r@example.org", "Rita");
  viewer = await makeMember(lab, "viewer", "v@example.org", "Vera");
  adminB = await makeMember(labB, "lab_admin", "b@example.org", "Bob");
  studyA1 = await newStudy(admin, "A1");
  studyA2 = await newStudy(admin, "A2");
  studyB = await newStudy(adminB, "B1");
  studySim = await newStudy(admin, "Sim", { nature: "simulated" });
  studyUndeclared = await newStudy(admin, "NonPseudo", { declared: false });
  parse.mockReset();
  parse.mockImplementation(async (file) => fakeParse(file) as never);
});

const events = (action: string) =>
  prisma.auditEvent.findMany({ where: { action }, orderBy: { id: "asc" } });
const trainingEvents = () =>
  prisma.auditEvent.count({ where: { action: { startsWith: "lab.training" } } });

describe("consentement", () => {
  it("par défaut : désactivé, champs nuls", async () => {
    expect(await getTrainingConsent(viewer)).toEqual({
      granted: false,
      grantedAt: null,
      grantedBy: null,
      version: null,
      history: [],
    });
  });

  it("accord par le responsable : trois champs et audit", async () => {
    await setTrainingConsent(admin, true);
    const lab = await prisma.laboratory.findUniqueOrThrow({ where: { id: admin.laboratoryId } });
    expect(lab.trainingConsentById).toBe(admin.userId);
    expect(lab.trainingConsentVersion).toBe(TRAINING_CONSENT_VERSION);
    expect(lab.trainingConsentAt).toBeInstanceOf(Date);
    const [ev] = await events("lab.training_consent.grant");
    expect(ev).toMatchObject({
      entityType: "Laboratory",
      entityId: admin.laboratoryId,
      laboratoryId: admin.laboratoryId,
      actorId: admin.userId,
    });
    expect(ev.after).toMatchObject({ name: "Labo A", granted: true, version: TRAINING_CONSENT_VERSION });
    expect(ev.before).toMatchObject({ granted: false, at: null, version: null });
    const view = await getTrainingConsent(viewer);
    expect(view).toMatchObject({ granted: true, grantedBy: "Adèle", version: TRAINING_CONSENT_VERSION, history: [] });
    expect(view.grantedAt).toBeInstanceOf(Date);
    const adminView = await getTrainingConsent(admin);
    expect(adminView.history).toHaveLength(1);
    expect(adminView.history[0]).toMatchObject({
      action: "lab.training_consent.grant",
      by: "Adèle",
    });
  });

  it("second accord refusé sans écriture ; retrait remet les champs à nul ; retrait à vide refusé", async () => {
    await expect(setTrainingConsent(admin, false)).rejects.toThrow(
      "Le consentement n'est pas donné.",
    );
    expect(await trainingEvents()).toBe(0);
    await setTrainingConsent(admin, true);
    await expect(setTrainingConsent(admin, true)).rejects.toThrow(
      "Le consentement est déjà donné.",
    );
    expect(await events("lab.training_consent.grant")).toHaveLength(1);
    await setTrainingConsent(admin, false);
    const lab = await prisma.laboratory.findUniqueOrThrow({ where: { id: admin.laboratoryId } });
    expect([lab.trainingConsentAt, lab.trainingConsentById, lab.trainingConsentVersion]).toEqual([
      null,
      null,
      null,
    ]);
    const [rev] = await events("lab.training_consent.revoke");
    expect(rev).toMatchObject({ entityType: "Laboratory", laboratoryId: admin.laboratoryId });
    expect(rev.after).toMatchObject({ granted: false });
  });

  it.each(["researcher", "viewer"] as const)(
    "%s : accord et export refusés sans écriture",
    async (who) => {
      const ctx = who === "researcher" ? researcher : viewer;
      await expect(setTrainingConsent(ctx, true)).rejects.toThrow(ADMIN_ONLY);
      await expect(buildTrainingExport(ctx, "json")).rejects.toThrow(ADMIN_ONLY);
      const lab = await prisma.laboratory.findUniqueOrThrow({ where: { id: admin.laboratoryId } });
      expect(lab.trainingConsentAt).toBeNull();
      expect(await trainingEvents()).toBe(0);
    },
  );
});

describe("buildTrainingExport", () => {
  it("export désactivé : refusé, aucun audit", async () => {
    await seedDecisions();
    await expect(buildTrainingExport(admin, "json")).rejects.toThrow(NO_EXPORT);
    expect(await events("lab.training_export")).toHaveLength(0);
  });

  it("JSON : dernières décisions acceptées ou corrigées du laboratoire, la plus récente d'abord", async () => {
    const s = await seedDecisions();
    await archiveStudy(admin, studyA2, "fin");
    await setTrainingConsent(admin, true);
    await setTrainingConsent(adminB, true);
    const file = await buildTrainingExport(admin, "json");
    expect(file.contentType).toBe("application/json; charset=utf-8");
    expect(file.fileName).toMatch(
      /^microtrace-labo-a-entrainement-spectral-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const doc = JSON.parse(file.body);
    expect(doc).toMatchObject({
      format: "microtrace.spectral-training-export",
      version: 1,
      laboratory: { slug: "labo-a", name: "Labo A" },
      consent: { version: TRAINING_CONSENT_VERSION },
    });
    expect(doc.notice).toContain("loi 18-07");
    expect(doc.prerequisites).toContain("résultats validés");
    expect(doc.notice).toContain("études simulées");
    expect(doc.notice).toContain("pseudonymisation");
    expect(doc).toMatchObject({ total_rows: 4, truncated: false });
    const rows = doc.rows as Record<string, unknown>[];
    expect(rows.map((r) => r.analysis_id)).toEqual([s.a1.id, s.a2.id, s.a6.id, s.a7.id]);
    expect(rows.map((r) => r.label)).toEqual(["PE", "PP", "PS", "PE"]);
    expect(rows.map((r) => r.decision)).toEqual(["accepted", "corrected", "corrected", "accepted"]);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual([...EXPORT_COLUMNS, "spectrum"].sort());
      expect(r).not.toHaveProperty("file_base64");
      expect(r).not.toHaveProperty("file_name");
      expect(r).not.toHaveProperty("note");
      expect(r).not.toHaveProperty("title");
    }
    expect(rows[0]).toMatchObject({
      study_id: studyA1,
      study_nature: "laboratory",
      technique: "raman",
      x_unit: "nm",
      y_unit: "intensity",
      laser_nm: 532,
      file_size: s.a1.bytes.length,
      model_name: "c5-spectral",
      model_version: "s1",
      proposed_polymer: "PE",
      proposed_status: "identified",
      score: 0.9,
    });
    // Seulement les colonnes numériques lues par le moteur : jamais les octets ni le texte du fichier.
    expect(rows[0].spectrum).toEqual({ x: [100, 200], y: [1, 2] });
    expect(file.body).not.toContain("# a1");
    expect(file.body).not.toContain(s.sim.id);
    expect(file.body).not.toContain(s.undeclared.id);
    expect(file.body).not.toContain("nom-secret");
    expect(file.body).not.toContain("note-secrete");
    expect(file.body).not.toContain(s.b1.id);
    const [ev] = await events("lab.training_export");
    expect(ev.after).toEqual({
      format: "json",
      rows: 4,
      consentVersion: TRAINING_CONSENT_VERSION,
      truncated: false,
      bodySha256: sha(new TextEncoder().encode(file.body)),
    });
    expect(ev).toMatchObject({ entityType: "Laboratory", laboratoryId: admin.laboratoryId });
  });

  it("études simulées et études sans pseudonymisation déclarée : jamais exportées (JSON et CSV)", async () => {
    const s = await seedDecisions();
    await setTrainingConsent(admin, true);
    for (const format of ["json", "csv"] as const) {
      const body = (await buildTrainingExport(admin, format)).body;
      expect(body).not.toContain(s.sim.id);
      expect(body).not.toContain(s.undeclared.id);
      expect(body).not.toContain("simulated");
    }
    const logged = await events("lab.training_export");
    expect(logged.map((e) => (e.after as { rows: number }).rows)).toEqual([4, 4]);
  });

  it("l'octet brut ne sort jamais : l'export ne porte que les nombres lus par le moteur", async () => {
    await seedDecisions();
    await setTrainingConsent(admin, true);
    const body = (await buildTrainingExport(admin, "json")).body;
    expect(parse).toHaveBeenCalledTimes(4);
    expect(body).not.toMatch(/file_base64|nom-secret|# a/);
  });

  it("fichier illisible pour le moteur : spectrum nul et spectrum_unreadable", async () => {
    const a = await analysis(studyA1, "bad");
    await decide(studyA1, a.id, "accepted", "PE", 1);
    await setTrainingConsent(admin, true);
    parse.mockRejectedValue(new EngineError(422, "Fichier vide."));
    const doc = JSON.parse((await buildTrainingExport(admin, "json")).body);
    expect(doc.rows[0]).toMatchObject({ spectrum: null, spectrum_unreadable: true });
  });

  it("fichier du magasin altéré : spectrum nul et file_corrupt", async () => {
    const a = await analysis(studyA1, "tampered");
    await decide(studyA1, a.id, "accepted", "PE", 1);
    const row = await prisma.modelPrediction.findUniqueOrThrow({ where: { id: a.id } });
    writeFileSync(path.join(dir, "files", row.inputFileSha256!), "autre contenu");
    await setTrainingConsent(admin, true);
    const doc = JSON.parse((await buildTrainingExport(admin, "json")).body);
    expect(doc.rows[0]).toMatchObject({ spectrum: null, file_corrupt: true });
    expect(doc.rows[0]).not.toHaveProperty("file_missing");
  });

  it("export trop volumineux : refusé avec le message, aucun audit", async () => {
    await seedDecisions();
    await setTrainingConsent(admin, true);
    await expect(buildTrainingExport(admin, "json", "spectral", { maxFilesBytes: 10 })).rejects.toThrow(
      "Export trop volumineux (50 Mo maximum) : contactez l'équipe MicroTrace.",
    );
    expect(await events("lab.training_export")).toHaveLength(0);
  });

  it("retrait du consentement pendant l'export : refusé, ni fichier ni audit", async () => {
    await seedDecisions();
    await setTrainingConsent(admin, true);
    parse.mockImplementationOnce(async (file) => {
      await setTrainingConsent(admin, false);
      return fakeParse(file) as never;
    });
    await expect(buildTrainingExport(admin, "json")).rejects.toThrow(NO_EXPORT);
    expect(await events("lab.training_export")).toHaveLength(0);
  });

  it("texte du consentement changé (version différente) : à renouveler, aucun audit", async () => {
    await seedDecisions();
    await setTrainingConsent(admin, true);
    await prisma.laboratory.update({
      where: { id: admin.laboratoryId },
      data: { trainingConsentVersion: "c0" },
    });
    await expect(buildTrainingExport(admin, "json")).rejects.toThrow(
      "Le texte du consentement a changé : retirez puis accordez de nouveau le consentement avant d'exporter.",
    );
    expect(await events("lab.training_export")).toHaveLength(0);
  });

  it("fichier retiré du magasin : spectrum nul et file_missing", async () => {
    const a = await analysis(studyA1, "gone", { store: false });
    await decide(studyA1, a.id, "accepted", "PE", 1);
    await setTrainingConsent(admin, true);
    const doc = JSON.parse((await buildTrainingExport(admin, "json")).body);
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0]).toMatchObject({ spectrum: null, file_missing: true });
    expect(parse).not.toHaveBeenCalled();
  });

  it("CSV : en-tête des colonnes, une ligne par décision retenue", async () => {
    await seedDecisions();
    await setTrainingConsent(admin, true);
    const file = await buildTrainingExport(admin, "csv");
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    expect(file.fileName).toMatch(/\.csv$/);
    const lines = file.body.split(/\r?\n/).filter((l) => l !== "");
    expect(lines[0]).toBe(EXPORT_COLUMNS.join(","));
    expect(lines).toHaveLength(5);
    expect(file.body).not.toContain("spectrum");
    expect(file.body).not.toContain("nom-secret");
    const [ev] = await events("lab.training_export");
    expect(ev.after).toMatchObject({ format: "csv", rows: 4, consentVersion: TRAINING_CONSENT_VERSION });
  });

  it("retrait puis export : refusé", async () => {
    await seedDecisions();
    await setTrainingConsent(admin, true);
    await setTrainingConsent(admin, false);
    await expect(buildTrainingExport(admin, "json")).rejects.toThrow(NO_EXPORT);
    expect(await events("lab.training_export")).toHaveLength(0);
  });

  it("le consentement de B n'ouvre pas l'export de A", async () => {
    await seedDecisions();
    await setTrainingConsent(adminB, true);
    await expect(buildTrainingExport(admin, "json")).rejects.toThrow(NO_EXPORT);
  });

  it("au plus 1 000 lignes, les plus récentes", async () => {
    const digest = sha(BYTES("many"));
    const n = 1001;
    await prisma.modelPrediction.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        ...analysisData(studyA1, digest, 5, `m${i}`),
        id: `an${i}`,
      })),
    });
    await prisma.modelPrediction.createMany({
      data: Array.from({ length: n }, (_, i) => decisionData(studyA1, `an${i}`, "accepted", "PE", i)),
    });
    await setTrainingConsent(admin, true);
    const lines = (await buildTrainingExport(admin, "csv")).body.split(/\r?\n/).filter((l) => l);
    expect(lines).toHaveLength(1001);
    expect(lines[1]).toContain("an1000");
    expect(lines.join("\n")).not.toContain("an0,");
  });

  it("au-delà de 1 000 lignes, le JSON annonce total_rows et truncated", async () => {
    const digest = sha(BYTES("many2"));
    await prisma.modelPrediction.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        ...analysisData(studyA1, digest, 5, `m${i}`),
        id: `bn${i}`,
      })),
    });
    await prisma.modelPrediction.createMany({
      data: Array.from({ length: 1001 }, (_, i) =>
        decisionData(studyA1, `bn${i}`, "accepted", "PE", i),
      ),
    });
    await setTrainingConsent(admin, true);
    const doc = JSON.parse((await buildTrainingExport(admin, "json")).body);
    expect(doc).toMatchObject({ total_rows: 1001, truncated: true });
    expect(doc.rows).toHaveLength(1000);
  });
});

describe("buildTrainingExport (images)", () => {
  const PNG = (tag: string) =>
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);
  const particles = [1, 2, 3].map((id) => ({
    id,
    contour: [
      [0, 0],
      [id, 0],
      [id, id],
    ],
    shape: "fragment",
    shape_label: "Fragment",
    shape_score: 0.8,
    shape_status: "proposed",
  }));

  async function imageAnalysis(
    studyId: string,
    tag: string,
    opts: { status?: "proposal" | "unreliable"; store?: boolean } = {},
  ) {
    const display = PNG(`display-${tag}`);
    const displaySha = sha(display);
    if (opts.store !== false) await storeFile(displaySha, display);
    const upload = sha(Buffer.from(`upload-${tag}`));
    const row = await prisma.modelPrediction.create({
      data: {
        studyId,
        kind: "image",
        inputFileSha256: upload,
        input: {
          role: "analysis",
          fileName: `photo-secrete-${tag}.png`,
          sizeBytes: 123,
          mimeType: "image/png",
          scaleEntered: "0.5",
          displaySha256: displaySha,
          annotatedSha256: sha(PNG(`annotated-${tag}`)),
        },
        output: {
          status: opts.status ?? "proposal",
          count: 3,
          scale: { um_per_px_input: 0.5, um_per_px_analysis: 1, source: "entered" },
          input: { analysis_width: 640, analysis_height: 480, sha256: upload },
          particles,
        },
        score: 0.8,
        modelName: "c6-microscopie",
        modelVersion: "i1",
        modelSha256: "e".repeat(64),
        createdAt: at(-100),
      },
    });
    return { id: row.id, display, upload };
  }

  const imageDecide = (
    studyId: string,
    analysisId: string,
    status: "accepted" | "corrected" | "rejected",
    minutes: number,
    opts: { excluded?: number[]; proposed?: string } = {},
  ) =>
    prisma.modelPrediction.create({
      data: {
        studyId,
        kind: "image",
        input: {
          role: "decision",
          analysisId,
          decision: status,
          excluded: opts.excluded ?? [],
          reshaped: opts.excluded ? [{ id: 1, shape: "fibre" }] : [],
          missedCount: 0,
        },
        output: {
          analysisId,
          proposedStatus: opts.proposed ?? "proposal",
          proposedCount: 3,
          validated: { count: status === "rejected" ? 0 : 3 - (opts.excluded?.length ?? 0) },
        },
        score: 0.8,
        modelName: "c6-microscopie",
        modelVersion: "i1",
        modelSha256: "e".repeat(64),
        status,
        decidedById: researcher.userId,
        decidedAt: at(minutes),
        decisionNote: "note-secrete",
        createdAt: at(minutes),
      },
    });

  async function seedImages() {
    const i1 = await imageAnalysis(studyA1, "i1");
    const i2 = await imageAnalysis(studyA1, "i2");
    const i3 = await imageAnalysis(studyA1, "i3");
    const i4 = await imageAnalysis(studyA1, "i4");
    const i5 = await imageAnalysis(studySim, "i5");
    const i6 = await imageAnalysis(studyUndeclared, "i6");
    const j1 = await imageAnalysis(studyB, "j1");
    await imageDecide(studyA1, i1.id, "accepted", 10);
    await imageDecide(studyA1, i2.id, "corrected", 11, { excluded: [2] });
    await imageDecide(studyA1, i3.id, "rejected", 12);
    await imageDecide(studySim, i5.id, "accepted", 13);
    await imageDecide(studyUndeclared, i6.id, "accepted", 14);
    await imageDecide(studyB, j1.id, "accepted", 15);
    return { i1, i2, i3, i4, i5, i6, j1 };
  }

  it("consentement c1 : export spectral et images refusés (à renouveler), sans audit ; c2 après renouvellement", async () => {
    await seedImages();
    await setTrainingConsent(admin, true);
    await prisma.laboratory.update({
      where: { id: admin.laboratoryId },
      data: { trainingConsentVersion: "c1" },
    });
    for (const kind of ["spectral", "image"] as const) {
      await expect(buildTrainingExport(admin, "json", kind)).rejects.toThrow(
        "Le texte du consentement a changé : retirez puis accordez de nouveau le consentement avant d'exporter.",
      );
    }
    expect(await events("lab.training_export")).toHaveLength(0);
    await setTrainingConsent(admin, false);
    await setTrainingConsent(admin, true);
    expect((await getTrainingConsent(admin)).version).toBe("c2");
    await expect(buildTrainingExport(admin, "json", "image")).resolves.toBeDefined();
  });

  it("texte du consentement : entrées exactes, sans doublon, une seule mention des images", () => {
    expect(TRAINING_CONSENT_DETAILS).toHaveLength(4);
    expect(new Set(TRAINING_CONSENT_DETAILS).size).toBe(4);
    expect(TRAINING_CONSENT_DETAILS.filter((d) => d.includes("images analysées"))).toEqual([
      "Seraient aussi utilisées : les images analysées telles que réécrites par MicroTrace (pixels seulement, sans aucune métadonnée), les contours proposés et les corrections des analyses d'images acceptées ou corrigées. Jamais le fichier d'image déposé ni son nom.",
    ]);
  });

  it("fichier corrompu, empreinte mal formée, contour mal formé : signalés sans plantage", async () => {
    const corrupt = await imageAnalysis(studyA1, "corrupt");
    await imageDecide(studyA1, corrupt.id, "accepted", 1);
    const badSha = await imageAnalysis(studyA1, "badsha");
    await prisma.modelPrediction.update({
      where: { id: badSha.id },
      data: {
        input: { role: "analysis", fileName: "x.png", displaySha256: "pas-une-empreinte" },
      },
    });
    await imageDecide(studyA1, badSha.id, "accepted", 2);
    const badContour = await imageAnalysis(studyA1, "badcontour");
    await prisma.modelPrediction.update({
      where: { id: badContour.id },
      data: {
        output: {
          status: "proposal",
          count: 1,
          scale: { um_per_px_input: 1, um_per_px_analysis: 1, source: "none" },
          input: { analysis_width: 1, analysis_height: 1 },
          particles: [{ id: 1, shape: "fragment", contour: [[0, "x"], [1]] }],
        },
      },
    });
    await imageDecide(studyA1, badContour.id, "accepted", 3);
    await setTrainingConsent(admin, true);
    const real = vi.spyOn(fileStore, "readStoredFile");
    real.mockImplementation(async (digest: string) => {
      if (digest === sha(corrupt.display)) throw new Error("Fichier du magasin corrompu.");
      return Buffer.from("png");
    });
    try {
      const doc = JSON.parse((await buildTrainingExport(admin, "json", "image")).body);
      const by = (id: string) => doc.rows.find((r: { analysis_id: string }) => r.analysis_id === id);
      expect(by(corrupt.id)).toMatchObject({ display_png_base64: null, file_corrupt: true });
      expect(by(badSha.id)).toMatchObject({ display_png_base64: null, file_missing: true });
      expect(by(badContour.id).particles[0]).toMatchObject({ contour: null, contour_invalid: true });
    } finally {
      real.mockRestore();
    }
  });

  it("retrait du consentement pendant l'export d'images : refusé, ni fichier ni audit", async () => {
    const a = await imageAnalysis(studyA1, "race");
    await imageDecide(studyA1, a.id, "accepted", 1);
    await setTrainingConsent(admin, true);
    const real = vi.spyOn(fileStore, "readStoredFile");
    real.mockImplementationOnce(async () => {
      await setTrainingConsent(admin, false);
      return a.display;
    });
    try {
      await expect(buildTrainingExport(admin, "json", "image")).rejects.toThrow(NO_EXPORT);
    } finally {
      real.mockRestore();
    }
    expect(await events("lab.training_export")).toHaveLength(0);
  });

  it("chercheur et lecteur : export d'images refusé", async () => {
    await setTrainingConsent(admin, true);
    for (const ctx of [researcher, viewer]) {
      await expect(buildTrainingExport(ctx, "json", "image")).rejects.toThrow(ADMIN_ONLY);
    }
  });

  it("total_rows n'inclut pas une analyse non fiable", async () => {
    const bad = await imageAnalysis(studyA1, "bad2", { status: "unreliable" });
    await imageDecide(studyA1, bad.id, "accepted", 1);
    const good = await imageAnalysis(studyA1, "good2");
    await imageDecide(studyA1, good.id, "accepted", 2);
    await setTrainingConsent(admin, true);
    const doc = JSON.parse((await buildTrainingExport(admin, "json", "image")).body);
    expect(doc).toMatchObject({ total_rows: 1, truncated: false });
    expect(doc.rows).toHaveLength(1);
  });

  it("historique : l'export d'images est distingué de l'export spectral", async () => {
    await setTrainingConsent(admin, true);
    await buildTrainingExport(admin, "csv", "image");
    await buildTrainingExport(admin, "csv");
    const kinds = (await getTrainingConsent(admin)).history
      .filter((h) => h.action === "lab.training_export")
      .map((h) => h.kind);
    expect(kinds).toEqual(["spectral", "image"]);
  });

  it("sans consentement : refusé, aucun audit", async () => {
    await seedImages();
    await expect(buildTrainingExport(admin, "json", "image")).rejects.toThrow(NO_EXPORT);
    expect(await events("lab.training_export")).toHaveLength(0);
  });

  it("JSON : dernières décisions acceptées ou corrigées, octets du magasin, particules, rien d'autre", async () => {
    const s = await seedImages();
    await setTrainingConsent(admin, true);
    await setTrainingConsent(adminB, true);
    const file = await buildTrainingExport(admin, "json", "image");
    expect(file.fileName).toMatch(/^microtrace-labo-a-entrainement-images-\d{4}-\d{2}-\d{2}\.json$/);
    const doc = JSON.parse(file.body);
    expect(doc).toMatchObject({
      format: "microtrace.image-training-export",
      version: 1,
      consent: { version: "c2" },
      total_rows: 2,
      truncated: false,
    });
    expect(doc.notice).toContain("images");
    const rows = doc.rows as Record<string, unknown>[];
    expect(rows.map((r) => r.analysis_id)).toEqual([s.i2.id, s.i1.id]);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        [...IMAGE_EXPORT_COLUMNS, "display_png_base64", "particles"].sort(),
      );
      for (const k of ["file_name", "note", "title", "file_base64"]) expect(r).not.toHaveProperty(k);
    }
    expect(Buffer.from(String(rows[0].display_png_base64), "base64")).toEqual(s.i2.display);
    expect(rows[0]).toMatchObject({
      decision: "corrected",
      study_nature: "laboratory",
      scale_um_per_px: 1,
      missed_count: 0,
      scale_source: "entered",
      analysis_width: 640,
      analysis_height: 480,
      proposed_count: 3,
      validated_count: 2,
      model_version: "i1",
    });
    const ps = rows[0].particles as { id: number; excluded: boolean; validated_shape: string | null }[];
    expect(ps[1]).toMatchObject({ id: 2, excluded: true, validated_shape: null });
    expect(ps[0]).toMatchObject({ id: 1, excluded: false, validated_shape: "fibre" });
    for (const forbidden of [
      "photo-secrete",
      "note-secrete",
      s.i2.upload,
      s.i5.id,
      s.i6.id,
      s.j1.id,
      s.i4.id,
      s.i3.id,
    ]) {
      expect(file.body).not.toContain(forbidden);
    }
    const [ev] = await events("lab.training_export");
    expect(ev.after).toMatchObject({ format: "json", rows: 2, consentVersion: "c2", kind: "image" });
  });

  it("analyse non fiable : exclue quelle que soit la décision", async () => {
    const bad = await imageAnalysis(studyA1, "bad", { status: "unreliable" });
    await imageDecide(studyA1, bad.id, "corrected", 1, { excluded: [1], proposed: "unreliable" });
    const good = await imageAnalysis(studyA1, "good");
    await imageDecide(studyA1, good.id, "accepted", 2);
    await setTrainingConsent(admin, true);
    const doc = JSON.parse((await buildTrainingExport(admin, "json", "image")).body);
    expect(doc.rows.map((r: { analysis_id: string }) => r.analysis_id)).toEqual([good.id]);
  });

  it("image retirée du magasin : display_png_base64 nul et file_missing", async () => {
    const a = await imageAnalysis(studyA1, "gone", { store: false });
    await imageDecide(studyA1, a.id, "accepted", 1);
    await setTrainingConsent(admin, true);
    const doc = JSON.parse((await buildTrainingExport(admin, "json", "image")).body);
    expect(doc.rows[0]).toMatchObject({ display_png_base64: null, file_missing: true });
  });

  it("trop volumineux : refusé, aucun audit", async () => {
    const a = await imageAnalysis(studyA1, "big");
    await imageDecide(studyA1, a.id, "accepted", 1);
    await setTrainingConsent(admin, true);
    await expect(buildTrainingExport(admin, "json", "image", { maxFilesBytes: 5 })).rejects.toThrow(
      "Export trop volumineux",
    );
    expect(await events("lab.training_export")).toHaveLength(0);
  });

  it("CSV : en-tête des colonnes, une ligne par analyse retenue, ni image ni particules", async () => {
    await seedImages();
    await setTrainingConsent(admin, true);
    const file = await buildTrainingExport(admin, "csv", "image");
    const lines = file.body.split(/\r?\n/).filter((l) => l !== "");
    expect(lines[0]).toBe(IMAGE_EXPORT_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
    expect(file.body).not.toContain("display_png_base64");
    expect(file.body).not.toContain("photo-secrete");
    const [ev] = await events("lab.training_export");
    expect(ev.after).toMatchObject({ format: "csv", rows: 2, kind: "image" });
  });
});
