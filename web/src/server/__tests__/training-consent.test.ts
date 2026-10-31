import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return { ...actual, engineClient: { validateContext: vi.fn(async () => ({})) } };
});

const dir = mkdtempSync(path.join(tmpdir(), "mt-consent-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

import { EXPORT_COLUMNS } from "@/lib/training-consent";
import { prisma } from "@/server/db";
import { storeFile } from "@/server/file-store";
import type { LabContext } from "@/server/lab-context";
import { createProject } from "@/server/projects";
import { archiveStudy, createStudy } from "@/server/studies";
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

async function newStudy(c: LabContext, title: string) {
  const p = await createProject(c, { title: `P ${title}` });
  return (await createStudy(c, p.id, { title, nature: "laboratory", blankCorrected: "unknown" })).id;
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
  return { a1, a2, a3, a4, a5, a6, a7, b1 };
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
    expect(lab.trainingConsentVersion).toBe("c1");
    expect(lab.trainingConsentAt).toBeInstanceOf(Date);
    const [ev] = await events("lab.training_consent.grant");
    expect(ev).toMatchObject({
      entityType: "Laboratory",
      entityId: admin.laboratoryId,
      laboratoryId: admin.laboratoryId,
      actorId: admin.userId,
    });
    expect(ev.after).toMatchObject({ name: "Labo A", granted: true, version: "c1" });
    expect(ev.before).toMatchObject({ granted: false, at: null, version: null });
    const view = await getTrainingConsent(viewer);
    expect(view).toMatchObject({ granted: true, grantedBy: "Adèle", version: "c1", history: [] });
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
      consent: { version: "c1" },
    });
    expect(doc.notice).toContain("loi 18-07");
    expect(doc.prerequisites).toContain("résultats validés");
    const rows = doc.rows as Record<string, unknown>[];
    expect(rows.map((r) => r.analysis_id)).toEqual([s.a1.id, s.a2.id, s.a6.id, s.a7.id]);
    expect(rows.map((r) => r.label)).toEqual(["PE", "PP", "PS", "PE"]);
    expect(rows.map((r) => r.decision)).toEqual(["accepted", "corrected", "corrected", "accepted"]);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual([...EXPORT_COLUMNS, "file_base64"].sort());
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
    expect(Buffer.from(rows[0].file_base64 as string, "base64")).toEqual(Buffer.from(s.a1.bytes));
    expect(file.body).not.toContain("nom-secret");
    expect(file.body).not.toContain("note-secrete");
    expect(file.body).not.toContain(s.b1.id);
    const [ev] = await events("lab.training_export");
    expect(ev.after).toEqual({ format: "json", rows: 4, consentVersion: "c1" });
    expect(ev).toMatchObject({ entityType: "Laboratory", laboratoryId: admin.laboratoryId });
  });

  it("fichier retiré du magasin : file_base64 nul et file_missing", async () => {
    const a = await analysis(studyA1, "gone", { store: false });
    await decide(studyA1, a.id, "accepted", "PE", 1);
    await setTrainingConsent(admin, true);
    const doc = JSON.parse((await buildTrainingExport(admin, "json")).body);
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0]).toMatchObject({ file_base64: null, file_missing: true });
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
    expect(file.body).not.toContain("file_base64");
    expect(file.body).not.toContain("nom-secret");
    const [ev] = await events("lab.training_export");
    expect(ev.after).toEqual({ format: "csv", rows: 4, consentVersion: "c1" });
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
});
