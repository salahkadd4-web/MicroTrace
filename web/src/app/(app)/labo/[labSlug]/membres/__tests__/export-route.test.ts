import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "mt-export-route-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

vi.mock("@/server/session", () => ({ requireUser: vi.fn() }));

import { GET, HEAD } from "../export-entrainement/route";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";
import { setTrainingConsent } from "@/server/training-consent";
import { resetDb } from "../../../../../../../test/db-reset";
import { makeLab, makeMember } from "../../../../../../../test/labs";

const sessionUser = vi.mocked(requireUser);
type Members = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const lab = await makeLab("Labo A", "labo-a");
  const labB = await makeLab("Labo B", "labo-b");
  return {
    admin: await makeMember(lab, "lab_admin", "ad@example.org"),
    researcher: await makeMember(lab, "researcher", "r@example.org"),
    viewer: await makeMember(lab, "viewer", "v@example.org"),
    outsider: await makeMember(labB, "lab_admin", "b@example.org"),
  };
}

const as = (m: { userId: string }, email: string) =>
  sessionUser.mockResolvedValue({ id: m.userId, name: "m", email });
const call = (q: string, slug = "labo-a") =>
  GET(new Request(`http://localhost/labo/${slug}/membres/export-entrainement${q}`), {
    params: Promise.resolve({ labSlug: slug }),
  });
const exports = () => prisma.auditEvent.count({ where: { action: "lab.training_export" } });

let m: Members;
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T23:30:00Z") });
  await resetDb();
  sessionUser.mockReset();
  m = await setup();
});

describe("GET membres/export-entrainement", () => {
  it("viewer, chercheur et non-membre : 404 « Introuvable. », sans audit", async () => {
    await setTrainingConsent(m.admin, true);
    for (const [who, email] of [
      [m.viewer, "v@example.org"],
      [m.researcher, "r@example.org"],
    ] as const) {
      as(who, email);
      const res = await call("?format=json");
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Introuvable.");
    }
    as(m.outsider, "b@example.org");
    expect((await call("?format=json")).status).toBe(404);
    expect(await exports()).toBe(0);
  });

  it("consentement absent : 403 en texte brut, sans audit", async () => {
    as(m.admin, "ad@example.org");
    const res = await call("?format=json");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("Consentement non donné : aucun export.");
    expect(await exports()).toBe(0);
  });

  it("format inconnu ou absent : 400", async () => {
    as(m.admin, "ad@example.org");
    for (const q of ["?format=xml", ""]) {
      const res = await call(q);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("Format d'export inconnu.");
    }
  });

  it("JSON : 200, pièce jointe nommée avec la date de Paris, en-têtes, audit", async () => {
    await setTrainingConsent(m.admin, true);
    as(m.admin, "ad@example.org");
    const res = await call("?format=json");
    expect(res.status).toBe(200);
    const name = "microtrace-labo-a-entrainement-spectral-2026-10-31.json";
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${name}"; filename*=UTF-8''${name}`,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const doc = JSON.parse(await res.text());
    expect(doc.rows).toEqual([]);
    expect(doc.prerequisites).toContain("résultats validés");
    expect(await exports()).toBe(1);
  });

  it("CSV : 200 avec l'en-tête des colonnes", async () => {
    await setTrainingConsent(m.admin, true);
    as(m.admin, "ad@example.org");
    const res = await call("?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect((await res.text()).startsWith("analysis_id,decision_id,")).toBe(true);
  });

  it("HEAD : 405 Allow GET, sans audit", async () => {
    const res = HEAD();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect(await exports()).toBe(0);
  });
});
