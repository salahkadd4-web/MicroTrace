import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return { ...actual, engineClient: { readTable: vi.fn() } };
});

import { redirect } from "next/navigation";
import { POST } from "@/app/(app)/labo/[labSlug]/etudes/[studyId]/imports/upload/route";
import { prisma } from "@/server/db";
import {
  EngineError,
  EngineUnavailableError,
  engineClient,
} from "@/server/engine/client";
import { requireUser } from "@/server/session";
import { resetDb } from "../../../../../../../../../test/db-reset";
import { makeLab, makeMember } from "../../../../../../../../../test/labs";

const dir = mkdtempSync(path.join(tmpdir(), "mt-route-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const readTable = vi.mocked(engineClient.readTable);
const sessionUser = vi.mocked(requireUser);
const TABLE = {
  filename: "r.csv",
  sha256: "x",
  size: 3,
  sheet: null,
  sheets: [],
  columns: ["a", "b"],
  preview: [],
  n_rows: 0,
};

let studyId: string;
let archivedId: string;

async function setup(role: "viewer" | "researcher") {
  const lab = await makeLab("Labo A", "labo-a");
  const m = await makeMember(lab, role, "m@example.org");
  sessionUser.mockResolvedValue({
    id: m.userId,
    name: "m",
    email: "m@example.org",
  });
  const project = await prisma.project.create({
    data: { title: "P", ownerId: m.userId, laboratoryId: lab.id },
  });
  const mk = (archivedAt: Date | null) =>
    prisma.study.create({
      data: {
        projectId: project.id,
        laboratoryId: lab.id,
        title: "E",
        nature: "laboratory",
        archivedAt,
      },
    });
  studyId = (await mk(null)).id;
  archivedId = (await mk(new Date())).id;
}

function req(
  bytes: Uint8Array | null,
  extra: Record<string, string> = {},
  name = "r.csv",
) {
  const form = new FormData();
  if (bytes)
    form.append(
      "file",
      new Blob([bytes as BlobPart], { type: "text/csv" }),
      name,
    );
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new Request("http://localhost/x", { method: "POST", body: form });
}
const call = (r: Request, slug = "labo-a", id = studyId) =>
  POST(r, { params: Promise.resolve({ labSlug: slug, studyId: id }) });
const stagingFiles = () =>
  existsSync(path.join(dir, "staging"))
    ? readdirSync(path.join(dir, "staging"))
    : [];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

beforeEach(async () => {
  await resetDb();
  rmSync(path.join(dir, "staging"), { recursive: true, force: true });
  readTable.mockReset();
  sessionUser.mockReset();
});

describe("POST imports/upload", () => {
  it("succès : jeton + table, dépôt écrit, feuille transmise", async () => {
    await setup("researcher");
    readTable.mockResolvedValue(TABLE);
    const res = await call(
      req(new TextEncoder().encode("a,b\n"), { sheet: "S1" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.table.columns).toEqual(["a", "b"]);
    expect(readTable).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "r.csv" }),
      "S1",
    );
    expect(stagingFiles()).toHaveLength(2);
  });

  it("viewer : message de rôle, moteur non appelé", async () => {
    await setup("viewer");
    const res = await call(req(new Uint8Array([1])));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Action réservée aux chercheurs du laboratoire.",
    });
    expect(readTable).not.toHaveBeenCalled();
  });

  it("slug inconnu ou non membre : 404 « Introuvable. »", async () => {
    await setup("researcher");
    await makeLab("Labo B", "labo-b");
    for (const slug of ["labo-b", "nope"]) {
      const res = await call(req(new Uint8Array([1])), slug);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Introuvable." });
    }
  });

  it("étude inconnue (ou d'un autre laboratoire) : 404", async () => {
    await setup("researcher");
    const res = await call(req(new Uint8Array([1])), "labo-a", "inconnue");
    expect(res.status).toBe(404);
  });

  it("étude archivée : 409, aucun dépôt", async () => {
    await setup("researcher");
    const res = await call(req(new Uint8Array([1])), "labo-a", archivedId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Étude archivée : lecture seule.",
    });
    expect(stagingFiles()).toEqual([]);
  });

  it("non connecté : 401 JSON", async () => {
    await setup("researcher");
    sessionUser.mockImplementation(async () => redirect("/connexion"));
    const res = await call(req(new Uint8Array([1])));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentification requise." });
  });

  it("50 Mo + 1 octet : 413, moteur non appelé, aucun dépôt", async () => {
    await setup("researcher");
    const res = await call(req(new Uint8Array(50 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "Fichier trop volumineux (50 Mo maximum).",
    });
    expect(readTable).not.toHaveBeenCalled();
    expect(stagingFiles()).toEqual([]);
  });

  it("Content-Length excessif : 413 sans lire le corps", async () => {
    await setup("researcher");
    const r = new Request("http://localhost/x", {
      method: "POST",
      headers: {
        "content-length": String(60 * 1024 * 1024),
        "content-type": "multipart/form-data; boundary=x",
      },
      body: "--x--",
    });
    expect((await call(r)).status).toBe(413);
  });

  it("flux sans Content-Length : coupé à la limite", async () => {
    await setup("researcher");
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 200) return c.close();
        c.enqueue(chunk);
      },
    });
    const r = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await call(r)).status).toBe(413);
    expect(pulled).toBeLessThan(80);
  });

  it("erreur 422 du moteur : message français, aucun dépôt", async () => {
    await setup("researcher");
    readTable.mockRejectedValue(new EngineError(422, "Fichier illisible."));
    const res = await call(req(new Uint8Array([1])));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Fichier illisible." });
    expect(stagingFiles()).toEqual([]);
  });

  it("moteur indisponible : 503, aucun dépôt", async () => {
    await setup("researcher");
    readTable.mockRejectedValue(new EngineUnavailableError());
    const res = await call(req(new Uint8Array([1])));
    expect(res.status).toBe(503);
    expect(stagingFiles()).toEqual([]);
    expect(await res.json()).toEqual({
      error: "Le moteur d'analyse est indisponible.",
    });
  });

  it("erreur inconnue : 500 générique, journal sans contenu", async () => {
    await setup("researcher");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    readTable.mockRejectedValue(new Error("secret-colonne-nom"));
    const res = await call(req(new Uint8Array([1])));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Une erreur inattendue est survenue.",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-colonne-nom");
    spy.mockRestore();
  });

  it("requête sans fichier : 400", async () => {
    await setup("researcher");
    expect((await call(req(null))).status).toBe(400);
  });

  it("fichier de 30 Mo reçu et déposé octet pour octet (sha256 égal)", async () => {
    await setup("researcher");
    const big = new Uint8Array(30 * 1024 * 1024).map((_, i) => (i * 31) & 255);
    readTable.mockResolvedValue(TABLE);
    const res = await call(req(big));
    expect(res.status).toBe(200);
    const { token } = await res.json();
    const sent = readTable.mock.calls[0][0].data as Uint8Array;
    expect(sha(sent)).toBe(sha(big));
    expect(sha(readFileSync(path.join(dir, "staging", `${token}.bin`)))).toBe(
      sha(big),
    );
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
  async function expectRefusedUnread(
    status: number,
    error: string,
    slug = "labo-a",
    id = studyId,
  ) {
    const { request, state } = countedRequest();
    const res = await call(request, slug, id);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(state.pulled).toBeLessThanOrEqual(1);
    expect(readTable).not.toHaveBeenCalled();
    expect(stagingFiles()).toEqual([]);
  }

  it("401 sans session", async () => {
    await setup("researcher");
    sessionUser.mockImplementation(async () => redirect("/connexion"));
    await expectRefusedUnread(401, "Authentification requise.");
  });

  it("404 non-membre", async () => {
    await setup("researcher");
    await makeLab("Labo B", "labo-b");
    await expectRefusedUnread(404, "Introuvable.", "labo-b");
  });

  it("403 viewer", async () => {
    await setup("viewer");
    await expectRefusedUnread(
      403,
      "Action réservée aux chercheurs du laboratoire.",
    );
  });

  it("403 laboratoire suspendu", async () => {
    await setup("researcher");
    await prisma.laboratory.update({
      where: { slug: "labo-a" },
      data: { suspendedAt: new Date() },
    });
    await expectRefusedUnread(403, "Laboratoire suspendu.");
  });

  it("409 étude archivée", async () => {
    await setup("researcher");
    await expectRefusedUnread(
      409,
      "Étude archivée : lecture seule.",
      "labo-a",
      archivedId,
    );
  });

  it("404 étude d'un autre laboratoire posté via son propre slug", async () => {
    await setup("researcher");
    const labB = await makeLab("Labo B", "labo-b");
    const ownerB = await makeMember(labB, "researcher", "b@example.org");
    const projectB = await prisma.project.create({
      data: { title: "PB", ownerId: ownerB.userId, laboratoryId: labB.id },
    });
    const studyB = await prisma.study.create({
      data: {
        projectId: projectB.id,
        laboratoryId: labB.id,
        title: "EB",
        nature: "laboratory",
      },
    });
    await expectRefusedUnread(404, "Introuvable.", "labo-a", studyB.id);
    const res = await call(req(new Uint8Array([1])), "labo-a", studyB.id);
    expect(res.status).toBe(404);
  });
});

describe("limite exacte", () => {
  it("un fichier de exactement 50 Mo est accepté", async () => {
    await setup("researcher");
    readTable.mockResolvedValue(TABLE);
    const res = await call(req(new Uint8Array(50 * 1024 * 1024)));
    expect(res.status).toBe(200);
  });
});
