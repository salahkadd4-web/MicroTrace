import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return { ...actual, engineClient: { identifySpectrum: vi.fn() } };
});

import { redirect } from "next/navigation";
import { POST } from "@/app/(app)/labo/[labSlug]/etudes/[studyId]/spectres/analyser/route";
import { prisma } from "@/server/db";
import {
  EngineError,
  EngineUnavailableError,
  engineClient,
  type SpectralIdentifyResponse,
} from "@/server/engine/client";
import { requireUser } from "@/server/session";
import { resetDb } from "../../../../../../../../../test/db-reset";
import { makeLab, makeMember } from "../../../../../../../../../test/labs";

const dir = mkdtempSync(path.join(tmpdir(), "mt-spectres-route-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const identify = vi.mocked(engineClient.identifySpectrum);
const sessionUser = vi.mocked(requireUser);
const BYTES = new TextEncoder().encode("100 1\n200 2\n");
const sha = createHash("sha256").update(BYTES).digest("hex");
const RESPONSE = {
  model: { name: "c5-spectral", version: "s1", sha256: "c".repeat(64) },
  input: { sha256: sha, technique_label: "Raman" },
  status: "identified",
  status_label: "Identifié (proposition)",
  candidates: [{ rank: 1, polymer: "PE", label: "Polyéthylène (PE)", score: 0.9, score_text: "0,900" }],
  correction_vocabulary: [],
} as unknown as SpectralIdentifyResponse;

let studyId: string;
let archivedId: string;

async function setup(role: "viewer" | "researcher") {
  const lab = await makeLab("Labo A", "labo-a");
  const m = await makeMember(lab, role, "m@example.org");
  sessionUser.mockResolvedValue({ id: m.userId, name: "m", email: "m@example.org" });
  const project = await prisma.project.create({
    data: { title: "P", ownerId: m.userId, laboratoryId: lab.id },
  });
  const mk = (archivedAt: Date | null) =>
    prisma.study.create({
      data: { projectId: project.id, laboratoryId: lab.id, title: "E", nature: "laboratory", archivedAt },
    });
  studyId = (await mk(null)).id;
  archivedId = (await mk(new Date())).id;
}

function req(bytes: Uint8Array | null = BYTES) {
  const form = new FormData();
  if (bytes) form.append("file", new Blob([bytes as BlobPart], { type: "text/plain" }), "s.txt");
  form.append("technique", "raman");
  form.append("x_unit", "nm");
  form.append("y_unit", "intensity");
  form.append("laser_nm", "532");
  return new Request("http://localhost/x", { method: "POST", body: form });
}
const call = (r: Request, slug = "labo-a", id = studyId) =>
  POST(r, { params: Promise.resolve({ labSlug: slug, studyId: id }) });

beforeEach(async () => {
  await resetDb();
  identify.mockReset();
  identify.mockResolvedValue(RESPONSE);
  sessionUser.mockReset();
});

describe("POST spectres/analyser", () => {
  it("succès : 200 { id }", async () => {
    await setup("researcher");
    const res = await call(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["id"]);
    expect(await prisma.modelPrediction.count({ where: { id: body.id, kind: "spectral" } })).toBe(1);
    expect(identify).toHaveBeenCalledWith(
      expect.objectContaining({ technique: "raman", xUnit: "nm", yUnit: "intensity", laserNm: "532" }),
    );
  });

  it("non connecté : 401", async () => {
    await setup("researcher");
    sessionUser.mockImplementation(async () => redirect("/connexion"));
    const res = await call(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentification requise." });
  });

  it("non-membre : 404", async () => {
    await setup("researcher");
    await makeLab("Labo B", "labo-b");
    const res = await call(req(), "labo-b");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable." });
  });

  it("viewer : 403, moteur non appelé", async () => {
    await setup("viewer");
    const res = await call(req());
    expect(res.status).toBe(403);
    expect(identify).not.toHaveBeenCalled();
  });

  it("étude archivée : 409", async () => {
    await setup("researcher");
    const res = await call(req(), "labo-a", archivedId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Étude archivée : lecture seule." });
  });

  it("content-length > 3 Mio : 413 sans appel au moteur", async () => {
    await setup("researcher");
    const r = new Request("http://localhost/x", {
      method: "POST",
      headers: {
        "content-length": String(3 * 1024 * 1024 + 1),
        "content-type": "multipart/form-data; boundary=x",
      },
      body: "--x--",
    });
    const res = await call(r);
    expect(res.status).toBe(413);
    expect(identify).not.toHaveBeenCalled();
  });

  it("fichier de 2 Mio + 1 : 413 sans appel au moteur", async () => {
    await setup("researcher");
    const res = await call(req(new Uint8Array(2 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Fichier trop volumineux (2 Mo maximum)." });
    expect(identify).not.toHaveBeenCalled();
  });

  it("non multipart : 400", async () => {
    await setup("researcher");
    const r = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect((await call(r)).status).toBe(400);
  });

  it("sans fichier : 400", async () => {
    await setup("researcher");
    expect((await call(req(null))).status).toBe(400);
  });

  it("moteur injoignable : 503", async () => {
    await setup("researcher");
    identify.mockRejectedValue(new EngineUnavailableError());
    const res = await call(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Le moteur d'analyse est indisponible." });
  });
});

describe("refus et correspondances", () => {
  it("laboratoire suspendu : 403", async () => {
    await setup("researcher");
    await prisma.laboratory.update({ where: { slug: "labo-a" }, data: { suspendedAt: new Date() } });
    const res = await call(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Laboratoire suspendu." });
    expect(identify).not.toHaveBeenCalled();
  });

  it("modèle indisponible (503 du moteur) : 503 et message fixe", async () => {
    await setup("researcher");
    identify.mockRejectedValue(new EngineError(503, "détail"));
    const res = await call(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Le modèle spectral est indisponible : aucune analyse n'est possible pour l'instant.",
    });
  });

  it("422 du moteur : transmis tel quel", async () => {
    await setup("researcher");
    identify.mockRejectedValue(new EngineError(422, "Ligne 7 : valeurs non numériques."));
    const res = await call(req());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Ligne 7 : valeurs non numériques." });
  });

  it("413 du moteur : 413", async () => {
    await setup("researcher");
    identify.mockRejectedValue(new EngineError(413, "Fichier trop volumineux (limite : 2 Mo)."));
    const res = await call(req());
    expect(res.status).toBe(413);
  });

  it("deux envois identiques simultanés : une seule analyse", async () => {
    await setup("researcher");
    const [a, b] = await Promise.all([call(req()), call(req())]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await a.json()).id).toBe((await b.json()).id);
    expect(await prisma.modelPrediction.count({ where: { kind: "spectral" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "spectral.analysis" } })).toBe(1);
  });
});

/** Corps en flux dont on compte les tirages : prouve que rien n'est lu avant l'autorisation. */
function countedRequest() {
  const state = { pulled: 0 };
  const chunk = new Uint8Array(64 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      state.pulled++;
      c.enqueue(chunk);
    },
  });
  const request = new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  return { request, state };
}

describe("autorisation avant lecture du corps", () => {
  async function expectRefusedUnread(status: number, slug = "labo-a", id = studyId) {
    const { request, state } = countedRequest();
    const res = await call(request, slug, id);
    expect(res.status).toBe(status);
    expect(state.pulled).toBeLessThanOrEqual(1);
    expect(identify).not.toHaveBeenCalled();
  }
  it("401 sans session", async () => {
    await setup("researcher");
    sessionUser.mockImplementation(async () => redirect("/connexion"));
    await expectRefusedUnread(401);
  });
  it("404 non-membre", async () => {
    await setup("researcher");
    await makeLab("Labo B", "labo-b");
    await expectRefusedUnread(404, "labo-b");
  });
  it("403 viewer", async () => {
    await setup("viewer");
    await expectRefusedUnread(403);
  });
  it("409 étude archivée", async () => {
    await setup("researcher");
    await expectRefusedUnread(409, "labo-a", archivedId);
  });
});
