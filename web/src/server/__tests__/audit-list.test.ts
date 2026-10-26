import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/engine/client", async (orig) => {
  const actual = await orig<typeof import("@/server/engine/client")>();
  return { ...actual, engineClient: { validateContext: vi.fn(async () => ({})), example: vi.fn() } };
});

import { listAuditEvents } from "@/server/audit";
import { createProject, getProject } from "@/server/projects";
import { addMethod, removeDetectionLimit, upsertDetectionLimit } from "@/server/study-settings";
import { createStudy, declarePseudonymisation, getStudyView } from "@/server/studies";
import { createUser, type SessionUser } from "@/server/users";
import { resetDb } from "../../../test/db-reset";
import { makeLab } from "../../../test/labs";

let actor: SessionUser;
let lab: { id: string };

beforeEach(async () => {
  await resetDb();
  lab = await makeLab("Labo");
  const u = await createUser({
    email: "a@example.org",
    name: "Alice Martin",
    password: "un-mot-de-passe-solide",
  });
  actor = { id: u.id, name: u.name, email: u.email };
});

async function newStudy(title: string, projectId?: string) {
  const pid = projectId ?? (await createProject(actor, { laboratoryId: lab.id, title: "P" })).id;
  return createStudy(actor, pid, { title, nature: "laboratory", blankCorrected: "unknown" });
}

describe("listAuditEvents", () => {
  it("renvoie les événements de l'étude et de ses objets, du plus récent au plus ancien, sans ceux des autres", async () => {
    const study = await newStudy("Étude A");
    const other = await newStudy("Étude B");
    const method = await addMethod(actor, study.id, { name: "M1", technique: "py_gc_ms" });
    await addMethod(actor, other.id, { name: "M2", technique: "py_gc_ms" });
    const limit = await upsertDetectionLimit(actor, study.id, {
      methodId: method.id,
      polymer: "PE",
      lod: 1,
      loq: 2,
      unitCode: "ug/mL",
      source: "test",
    });
    await removeDetectionLimit(actor, limit.id);
    await declarePseudonymisation(actor, study.id);

    const events = await listAuditEvents(study.id);
    expect(events.map((e) => e.action)).toEqual([
      "study.pseudonymisation.declare",
      "study.limit.remove",
      "study.limit.upsert",
      "study.method.add",
      "study.create",
    ]);
    expect(events.every((e) => e.actorName === "Alice Martin")).toBe(true);
    const times = events.map((e) => e.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe("lecture des vues", () => {
  it("getStudyView ajoute le nom de l'auteur de la pseudonymisation", async () => {
    const study = await newStudy("Étude A");
    await declarePseudonymisation(actor, study.id);
    const view = await getStudyView(study.id);
    expect(view?.pseudonymDeclaredByName).toBe("Alice Martin");
    expect(view?.project.title).toBe("P");
    expect(await getStudyView("inconnu")).toBeNull();
  });

  it("getProject renvoie les études, la plus récente d'abord", async () => {
    const project = await createProject(actor, { laboratoryId: lab.id, title: "P" });
    await newStudy("Première", project.id);
    await newStudy("Seconde", project.id);
    const found = await getProject(project.id);
    expect(found?.studies.map((s) => s.title)).toEqual(["Seconde", "Première"]);
    expect(await getProject("inconnu")).toBeNull();
  });
});
