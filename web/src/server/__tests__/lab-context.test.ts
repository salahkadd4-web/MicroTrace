import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn() }));

import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { createLaboratory, listMyLaboratories, slugify } from "@/server/labs";
import { assertRole, requireDefaultLab, requireLab } from "@/server/lab-context";
import { requireUser } from "@/server/session";
import { createUser } from "@/server/users";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const sessionUser = vi.mocked(requireUser);

async function login(email: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  sessionUser.mockResolvedValue({ id: u.id, name: u.name, email: u.email });
}

/** `notFound()` de Next lève une erreur au digest 404. */
const NOT_FOUND = expect.objectContaining({ digest: expect.stringContaining("404") });

beforeEach(async () => {
  await resetDb();
  sessionUser.mockReset();
});

describe("requireLab", () => {
  it("laisse passer un membre et renvoie son contexte", async () => {
    const lab = await makeLab("Labo A", "labo-a");
    const m = await makeMember(lab, "researcher", "m@example.org");
    await login("m@example.org");
    await expect(requireLab("labo-a")).resolves.toEqual({
      userId: m.userId,
      userName: "m",
      laboratoryId: lab.id,
      labSlug: "labo-a",
      labName: "Labo A",
      role: "researcher",
    });
  });

  it("non-membre et laboratoire inconnu : même notFound", async () => {
    const a = await makeLab("Labo A", "labo-a");
    await makeLab("Labo B", "labo-b");
    await makeMember(a, "lab_admin", "a@example.org");
    await login("a@example.org");
    await expect(requireLab("labo-b")).rejects.toEqual(NOT_FOUND);
    await expect(requireLab("n-existe-pas")).rejects.toEqual(NOT_FOUND);
  });

  it("laboratoire suspendu : « Laboratoire suspendu. » pour un membre, notFound pour un tiers", async () => {
    const lab = await makeLab("Labo A", "labo-a");
    await makeMember(lab, "viewer", "m@example.org");
    await createUser({ email: "x@example.org", name: "X", password: "mot-de-passe-solide-1" });
    await prisma.laboratory.update({ where: { id: lab.id }, data: { suspendedAt: new Date() } });
    await login("m@example.org");
    await expect(requireLab("labo-a")).rejects.toThrow(new DomainError("Laboratoire suspendu."));
    await login("x@example.org");
    await expect(requireLab("labo-a")).rejects.toEqual(NOT_FOUND);
  });

  it("relit l'appartenance en base à chaque appel (retrait immédiat)", async () => {
    const lab = await makeLab("Labo A", "labo-a");
    const m = await makeMember(lab, "viewer", "m@example.org");
    await login("m@example.org");
    await requireLab("labo-a");
    await prisma.membership.deleteMany({ where: { userId: m.userId } });
    await expect(requireLab("labo-a")).rejects.toEqual(NOT_FOUND);
  });

  it("rôle insuffisant : messages du §11", async () => {
    const lab = await makeLab("Labo A", "labo-a");
    await makeMember(lab, "viewer", "v@example.org");
    await makeMember(lab, "researcher", "r@example.org");
    await login("v@example.org");
    await expect(requireLab("labo-a", "researcher")).rejects.toThrow(
      "Action réservée aux chercheurs du laboratoire.",
    );
    await expect(requireLab("labo-a", "lab_admin")).rejects.toThrow(
      "Action réservée aux responsables du laboratoire.",
    );
    await login("r@example.org");
    await expect(requireLab("labo-a", "researcher")).resolves.toMatchObject({
      role: "researcher",
    });
    await expect(requireLab("labo-a", "lab_admin")).rejects.toThrow(
      "Action réservée aux responsables du laboratoire.",
    );
  });
});

describe("assertRole", () => {
  it("ordre viewer < researcher < lab_admin", () => {
    expect(() => assertRole({ role: "viewer" }, "viewer")).not.toThrow();
    expect(() => assertRole({ role: "viewer" }, "researcher")).toThrow(DomainError);
    expect(() => assertRole({ role: "researcher" }, "viewer")).not.toThrow();
    expect(() => assertRole({ role: "researcher" }, "researcher")).not.toThrow();
    expect(() => assertRole({ role: "researcher" }, "lab_admin")).toThrow(
      "Action réservée aux responsables du laboratoire.",
    );
    expect(() => assertRole({ role: "lab_admin" }, "lab_admin")).not.toThrow();
    expect(() => assertRole({ role: "lab_admin" }, "researcher")).not.toThrow();
  });
});

describe("requireDefaultLab (temporaire, tâche 11)", () => {
  it("prend le premier laboratoire par date de création ; sans appartenance : notFound", async () => {
    const newer = await makeLab("Récent", "recent");
    const older = await makeLab("Ancien", "ancien");
    await prisma.laboratory.update({
      where: { id: older.id },
      data: { createdAt: new Date("2020-01-01") },
    });
    const m = await makeMember(newer, "researcher", "m@example.org");
    await prisma.membership.create({
      data: { userId: m.userId, laboratoryId: older.id, role: "viewer" },
    });
    await login("m@example.org");
    await expect(requireDefaultLab()).resolves.toMatchObject({ labSlug: "ancien", role: "viewer" });
    await expect(requireDefaultLab("researcher")).rejects.toThrow(
      "Action réservée aux chercheurs du laboratoire.",
    );
    await createUser({ email: "x@example.org", name: "X", password: "mot-de-passe-solide-1" });
    await login("x@example.org");
    await expect(requireDefaultLab()).rejects.toEqual(NOT_FOUND);
  });
});

describe("slugify et createLaboratory", () => {
  it("slugify : ASCII minuscule, tirets, 48 caractères, repli « labo »", () => {
    expect(slugify("Labo Bio Oran")).toBe("labo-bio-oran");
    expect(slugify("  Écôle d'Été — Çà & Là !! ")).toBe("ecole-d-ete-ca-la");
    expect(slugify("???")).toBe("labo");
    expect(slugify("a".repeat(80))).toHaveLength(48);
    expect(slugify("a".repeat(47) + " b")).toBe("a".repeat(47));
  });

  async function platformAdmin() {
    const u = await createUser({
      email: "root@example.org",
      name: "Root",
      password: "mot-de-passe-solide-1",
      isPlatformAdmin: true,
    });
    return { id: u.id, name: u.name, email: u.email };
  }

  it("suffixe numérique en cas de collision, audit lab.create portant le laboratoire", async () => {
    const admin = await platformAdmin();
    const a = await createLaboratory(admin, { name: "Labo Bio Oran" });
    const b = await createLaboratory(admin, { name: "Labo Bio Oran" });
    const c = await createLaboratory(admin, { name: "labo bio oran" });
    expect([a.slug, b.slug, c.slug]).toEqual([
      "labo-bio-oran",
      "labo-bio-oran-2",
      "labo-bio-oran-3",
    ]);
    const events = await prisma.auditEvent.findMany({ where: { action: "lab.create" } });
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.laboratoryId).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(events.every((e) => e.actorId === admin.id && e.entityType === "Laboratory")).toBe(true);
  });

  it("le suffixe respecte la limite de 48 caractères", async () => {
    const admin = await platformAdmin();
    const long = "a".repeat(60);
    await createLaboratory(admin, { name: long });
    const second = await createLaboratory(admin, { name: long });
    expect(second.slug).toBe("a".repeat(46) + "-2");
    expect(second.slug).toHaveLength(48);
  });

  it("refusé à un utilisateur qui n'est pas administrateur de la plateforme (relu en base)", async () => {
    const u = await createUser({
      email: "u@example.org",
      name: "U",
      password: "mot-de-passe-solide-1",
    });
    await expect(
      createLaboratory({ id: u.id, name: u.name, email: u.email }, { name: "Labo" }),
    ).rejects.toThrow("Action réservée à l'équipe de la plateforme.");
    expect(await prisma.laboratory.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "lab.create" } })).toBe(0);
  });

  it("refuse un nom vide", async () => {
    const admin = await platformAdmin();
    await expect(createLaboratory(admin, { name: "  " })).rejects.toThrow(
      "Le nom du laboratoire est obligatoire.",
    );
  });
});

describe("listMyLaboratories et unicité d'appartenance", () => {
  it("liste les laboratoires de l'utilisateur, du plus ancien au plus récent", async () => {
    const b = await makeLab("B", "b");
    const a = await makeLab("A", "a");
    await prisma.laboratory.update({
      where: { id: a.id },
      data: { createdAt: new Date("2020-01-01") },
    });
    const m = await makeMember(b, "viewer", "m@example.org");
    await prisma.membership.create({
      data: { userId: m.userId, laboratoryId: a.id, role: "lab_admin" },
    });
    await makeLab("C", "c");
    expect(await listMyLaboratories(m.userId)).toEqual([
      { id: a.id, slug: "a", name: "A", role: "lab_admin", suspended: false },
      { id: b.id, slug: "b", name: "B", role: "viewer", suspended: false },
    ]);
  });

  it("une seule appartenance par (utilisateur, laboratoire)", async () => {
    const lab = await makeLab("A", "a");
    const m = await makeMember(lab, "viewer", "m@example.org");
    await expect(
      prisma.membership.create({
        data: { userId: m.userId, laboratoryId: lab.id, role: "lab_admin" },
      }),
    ).rejects.toThrow();
  });
});
