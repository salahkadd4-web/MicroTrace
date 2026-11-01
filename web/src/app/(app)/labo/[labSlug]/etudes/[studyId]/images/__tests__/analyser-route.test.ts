import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return { ...actual, engineClient: { analyzeImage: vi.fn() } };
});

import { redirect } from "next/navigation";
import { POST } from "@/app/(app)/labo/[labSlug]/etudes/[studyId]/images/analyser/route";
import { prisma } from "@/server/db";
import { EngineError, EngineUnavailableError, engineClient } from "@/server/engine/client";
import { requireUser } from "@/server/session";
import { resetDb } from "../../../../../../../../../test/db-reset";
import { proposalFor } from "../../../../../../../../../test/images";
import { makeLab, makeMember } from "../../../../../../../../../test/labs";

const dir = mkdtempSync(path.join(tmpdir(), "mt-images-route-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const analyze = vi.mocked(engineClient.analyzeImage);
const sessionUser = vi.mocked(requireUser);
const BYTES = new TextEncoder().encode("faux-fichier-image");

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

function req(bytes: Uint8Array | null = BYTES, scale: string | null = "0.5") {
  const form = new FormData();
  if (bytes) form.append("file", new Blob([bytes as BlobPart], { type: "image/png" }), "photo-secrete.png");
  if (scale !== null) form.append("scale_um_per_px", scale);
  return new Request("http://localhost/x", { method: "POST", body: form });
}
const call = (r: Request, slug = "labo-a", id = studyId) =>
  POST(r, { params: Promise.resolve({ labSlug: slug, studyId: id }) });

beforeEach(async () => {
  await resetDb();
  analyze.mockReset();
  analyze.mockImplementation(async (a) => proposalFor(a.file.data as Uint8Array));
  sessionUser.mockReset();
});

describe("POST images/analyser", () => {
  it("succès : 200 { id }, analyse d'image enregistrée, échelle transmise", async () => {
    await setup("researcher");
    const res = await call(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["id"]);
    expect(await prisma.modelPrediction.count({ where: { id: body.id, kind: "image" } })).toBe(1);
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ scaleUmPerPx: "0.5" }));
    const sha = createHash("sha256").update(BYTES).digest("hex");
    expect((await prisma.modelPrediction.findUniqueOrThrow({ where: { id: body.id } })).inputFileSha256).toBe(sha);
  });

  it("sans échelle : null", async () => {
    await setup("researcher");
    expect((await call(req(BYTES, null))).status).toBe(200);
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ scaleUmPerPx: null }));
  });

  it("échelle invalide : 422 sans appel au moteur", async () => {
    await setup("researcher");
    const res = await call(req(BYTES, "1e3"));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Échelle invalide." });
    expect(analyze).not.toHaveBeenCalled();
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
    expect((await call(req())).status).toBe(403);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("étude archivée : 409", async () => {
    await setup("researcher");
    const res = await call(req(), "labo-a", archivedId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Étude archivée : lecture seule." });
  });

  it("laboratoire suspendu : 403", async () => {
    await setup("researcher");
    await prisma.laboratory.update({ where: { slug: "labo-a" }, data: { suspendedAt: new Date() } });
    const res = await call(req());
    expect(res.status).toBe(403);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("content-length > 26 Mio : 413 sans appel au moteur", async () => {
    await setup("researcher");
    const r = new Request("http://localhost/x", {
      method: "POST",
      headers: {
        "content-length": String(26 * 1024 * 1024 + 1),
        "content-type": "multipart/form-data; boundary=x",
      },
      body: "--x--",
    });
    expect((await call(r)).status).toBe(413);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("fichier de 25 Mio + 1 : 413 sans appel au moteur", async () => {
    await setup("researcher");
    const res = await call(req(new Uint8Array(25 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Fichier trop volumineux (25 Mo maximum)." });
    expect(analyze).not.toHaveBeenCalled();
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
    analyze.mockRejectedValue(new EngineUnavailableError());
    const res = await call(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Le moteur d'analyse est indisponible." });
  });

  it("modèle indisponible (503 du moteur) : 503 et message fixe", async () => {
    await setup("researcher");
    analyze.mockRejectedValue(new EngineError(503, "détail"));
    const res = await call(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Le modèle d'images est indisponible : aucune analyse n'est possible pour l'instant.",
    });
  });

  it("422 du moteur transmis tel quel ; 413 du moteur : 413", async () => {
    await setup("researcher");
    analyze.mockRejectedValueOnce(new EngineError(422, "Image illisible ou tronquée."));
    const res = await call(req());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Image illisible ou tronquée." });
    analyze.mockRejectedValueOnce(new EngineError(413, "Fichier trop volumineux (limite : 25 Mo)."));
    expect((await call(req())).status).toBe(413);
  });

  it("deux envois identiques simultanés : une seule analyse", async () => {
    await setup("researcher");
    const [a, b] = await Promise.all([call(req()), call(req())]);
    expect((await a.json()).id).toBe((await b.json()).id);
    expect(await prisma.modelPrediction.count({ where: { kind: "image" } })).toBe(1);
  });

  it("aucun nom de fichier dans les réponses d'erreur", async () => {
    await setup("researcher");
    analyze.mockRejectedValue(new EngineError(500, "boum"));
    const res = await call(req());
    expect(JSON.stringify(await res.json())).not.toContain("secrete");
  });
});
