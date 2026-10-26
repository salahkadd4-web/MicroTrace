import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/engine/client", async (orig) => ({
  ...(await orig<typeof import("@/server/engine/client")>()),
  engineClient: { validateContext: vi.fn(async () => ({})), example: vi.fn() },
}));

import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";
import { createProjectAction } from "@/app/(app)/labo/[labSlug]/projets/actions";
import { createStudyAction } from "@/app/(app)/labo/[labSlug]/projets/[projectId]/actions";
import { archiveStudyAction } from "@/app/(app)/labo/[labSlug]/etudes/[studyId]/parametres/actions";

const NOT_FOUND = expect.objectContaining({ digest: expect.stringContaining("404") });
const FORBIDDEN = "Action réservée aux chercheurs du laboratoire.";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function login(email: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  vi.mocked(requireUser).mockResolvedValue({ id: u.id, name: u.name, email: u.email });
}

beforeEach(async () => {
  await resetDb();
});

describe("actions par laboratoire (slug revérifié côté serveur)", () => {
  it("slug d'un laboratoire dont on n'est pas membre : introuvable, rien n'est écrit", async () => {
    const a = await makeLab("Labo A", "labo-a");
    await makeLab("Labo B", "labo-b");
    await makeMember(a, "researcher", "a@example.org");
    await login("a@example.org");
    await expect(
      createProjectAction("labo-b", {}, form({ title: "Intrus", description: "" })),
    ).rejects.toEqual(NOT_FOUND);
    await expect(
      createProjectAction("inconnu", {}, form({ title: "Intrus", description: "" })),
    ).rejects.toEqual(NOT_FOUND);
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "project.create" } })).toBe(0);
  });

  it("un chercheur crée un projet dans son laboratoire et est redirigé sous /labo/<slug>", async () => {
    const a = await makeLab("Labo A", "labo-a");
    await makeMember(a, "researcher", "a@example.org");
    await login("a@example.org");
    await expect(
      createProjectAction("labo-a", {}, form({ title: "Projet", description: "" })),
    ).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/labo\/labo-a\/projets\// ) });
    const projects = await prisma.project.findMany();
    expect(projects).toHaveLength(1);
    expect(projects[0].laboratoryId).toBe(a.id);
  });

  it("un lecteur qui appelle une écriture reçoit le refus de rôle, sans écriture", async () => {
    const a = await makeLab("Labo A", "labo-a");
    await makeMember(a, "viewer", "v@example.org");
    await login("v@example.org");
    await expect(
      createProjectAction("labo-a", {}, form({ title: "Projet", description: "" })),
    ).resolves.toEqual({ error: FORBIDDEN });
    expect(await prisma.project.count()).toBe(0);
  });

  it("une étude d'un autre laboratoire reste introuvable même avec le bon slug du sien", async () => {
    const a = await makeLab("Labo A", "labo-a");
    const b = await makeLab("Labo B", "labo-b");
    await makeMember(a, "researcher", "a@example.org");
    const other = await makeMember(b, "researcher", "b@example.org");
    const project = await prisma.project.create({
      data: { title: "P", description: "", ownerId: other.userId, laboratoryId: b.id },
    });
    await login("a@example.org");
    const result = await createStudyAction(
      "labo-a",
      {},
      form({ projectId: project.id, title: "E", nature: "laboratory", blankCorrected: "unknown" }),
    );
    expect(result.error).toBeTruthy();
    expect(await prisma.study.count()).toBe(0);
  });

  it("archiver avec le slug d'un laboratoire non membre : introuvable", async () => {
    const a = await makeLab("Labo A", "labo-a");
    const b = await makeLab("Labo B", "labo-b");
    await makeMember(a, "researcher", "a@example.org");
    await makeMember(b, "researcher", "b@example.org");
    await login("a@example.org");
    await expect(archiveStudyAction("labo-b", "x", "motif")).rejects.toEqual(NOT_FOUND);
  });

  it("laboratoire suspendu : le refus métier est renvoyé au formulaire", async () => {
    const a = await makeLab("Labo A", "labo-a");
    await makeMember(a, "researcher", "a@example.org");
    await prisma.laboratory.update({ where: { id: a.id }, data: { suspendedAt: new Date() } });
    await login("a@example.org");
    await expect(
      createProjectAction("labo-a", {}, form({ title: "Projet", description: "" })),
    ).resolves.toEqual({ error: "Laboratoire suspendu." });
    expect(await prisma.project.count()).toBe(0);
  });
});
