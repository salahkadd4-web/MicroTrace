import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return { ...actual, engineClient: { analyzeImage: vi.fn(), validateImage: vi.fn() } };
});

import { redirect } from "next/navigation";
import { GET as annotatedGET, HEAD as annotatedHEAD } from "../[analysisId]/annotee/route";
import { GET as imageGET, HEAD as imageHEAD } from "../[analysisId]/image/route";
import { GET as particlesGET, HEAD as particlesHEAD } from "../[analysisId]/particules/route";
import { GET as countsGET, HEAD as countsHEAD } from "../comptages/route";
import { prisma } from "@/server/db";
import { engineClient } from "@/server/engine/client";
import { analyzeImage, recordImageDecision } from "@/server/images";
import type { LabContext } from "@/server/lab-context";
import { requireUser } from "@/server/session";
import { resetDb } from "../../../../../../../../../test/db-reset";
import { VALIDATED, proposalFor } from "../../../../../../../../../test/images";
import { makeLab, makeMember } from "../../../../../../../../../test/labs";

const dir = mkdtempSync(path.join(tmpdir(), "mt-images-files-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sessionUser = vi.mocked(requireUser);
const BYTES = new TextEncoder().encode("faux-fichier-image") as Uint8Array<ArrayBuffer>;
const FILE_NAME = "photo-de-madame-dupont.tif";

let studyId: string;
let analysisId: string;
let otherStudyId: string;
let otherAnalysisId: string;

async function seed() {
  const lab = await makeLab("Labo A", "labo-a");
  const labB = await makeLab("Labo B", "labo-b");
  const researcher = await makeMember(lab, "researcher", "r@example.org", "Rita");
  const viewer = await makeMember(lab, "viewer", "v@example.org", "Vera");
  const bob = await makeMember(labB, "researcher", "b@example.org", "Bob");
  const studyOf = async (c: LabContext) => {
    const project = await prisma.project.create({
      data: { title: "P", ownerId: c.userId, laboratoryId: c.laboratoryId },
    });
    return (
      await prisma.study.create({
        data: { projectId: project.id, laboratoryId: c.laboratoryId, title: "E", nature: "laboratory" },
      })
    ).id;
  };
  studyId = await studyOf(researcher);
  otherStudyId = await studyOf(bob);
  const put = (c: LabContext, sid: string) =>
    analyzeImage(c, sid, { fileName: FILE_NAME, mimeType: "image/tiff", bytes: BYTES, scaleUmPerPx: "0.5" });
  analysisId = (await put(researcher, studyId)).id;
  otherAnalysisId = (await put(bob, otherStudyId)).id;
  await recordImageDecision(researcher, studyId, analysisId, { decision: "accepted" });
  await recordImageDecision(bob, otherStudyId, otherAnalysisId, { decision: "accepted" });
  sessionUser.mockResolvedValue({ id: viewer.userId, name: "v", email: "v@example.org" });
}

const params = (over: Record<string, string> = {}) => ({
  params: Promise.resolve({ labSlug: "labo-a", studyId, analysisId, ...over }),
});
const req = () => new Request("http://localhost/x");
const allHeaders = (res: Response) => JSON.stringify([...res.headers.entries()]);

beforeEach(async () => {
  await resetDb();
  vi.mocked(engineClient.analyzeImage).mockImplementation(async (a) =>
    proposalFor(a.file.data as Uint8Array),
  );
  vi.mocked(engineClient.validateImage).mockResolvedValue(VALIDATED);
  sessionUser.mockReset();
});

describe("image d'analyse", () => {
  it("200 image/png, nosniff, private no-store, inline", async () => {
    await seed();
    const res = await imageGET(req(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe("inline");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(allHeaders(res)).not.toContain("dupont");
  });

  it("analyse d'un autre laboratoire : 404", async () => {
    await seed();
    const res = await imageGET(req(), params({ studyId: otherStudyId, analysisId: otherAnalysisId }));
    expect(res.status).toBe(404);
    expect((await imageGET(req(), params({ analysisId: otherAnalysisId }))).status).toBe(404);
    expect((await imageGET(req(), params({ analysisId: "inconnue" }))).status).toBe(404);
  });

  it("401 sans session, 404 hors laboratoire, HEAD 405", async () => {
    await seed();
    sessionUser.mockImplementation(async () => redirect("/connexion"));
    expect((await imageGET(req(), params())).status).toBe(401);
    sessionUser.mockReset();
    sessionUser.mockResolvedValue({ id: "x", name: "x", email: "x@example.org" });
    expect((await imageGET(req(), params({ labSlug: "labo-b" }))).status).toBe(404);
    const head = await imageHEAD();
    expect(head.status).toBe(405);
    expect(head.headers.get("allow")).toBe("GET");
  });
});

describe("image annotée", () => {
  it("pièce jointe nommée microtrace-image-annotee-<date>.png", async () => {
    await seed();
    const res = await annotatedGET(req(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="microtrace-image-annotee-\d{4}-\d{2}-\d{2}\.png"/,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(allHeaders(res)).not.toContain("dupont");
  });
  it("404 autre laboratoire, HEAD 405", async () => {
    await seed();
    expect(
      (await annotatedGET(req(), params({ studyId: otherStudyId, analysisId: otherAnalysisId }))).status,
    ).toBe(404);
    expect((await annotatedHEAD()).status).toBe(405);
  });
});

describe("CSV", () => {
  it("particules : text/csv, nom sans le fichier déposé", async () => {
    await seed();
    const res = await particlesGET(req(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="microtrace-particules-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(allHeaders(res)).not.toContain("dupont");
    expect(await res.text()).not.toContain("dupont");
    expect(
      (await particlesGET(req(), params({ studyId: otherStudyId, analysisId: otherAnalysisId }))).status,
    ).toBe(404);
    expect((await particlesHEAD()).status).toBe(405);
  });

  it("comptages : text/csv, audit, jamais une ligne d'un autre laboratoire", async () => {
    await seed();
    const res = await countsGET(req(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="microtrace-comptages-particules-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const body = await res.text();
    expect(body).toContain(analysisId);
    expect(body).not.toContain(otherAnalysisId);
    expect(body).not.toContain("dupont");
    expect(allHeaders(res)).not.toContain("dupont");
    expect(await prisma.auditEvent.count({ where: { action: "image.counts_export" } })).toBe(1);
    expect((await countsGET(req(), params({ studyId: otherStudyId }))).status).toBe(404);
    expect((await countsHEAD()).status).toBe(405);
    expect(await prisma.auditEvent.count({ where: { action: "image.counts_export" } })).toBe(1);
  });
});
