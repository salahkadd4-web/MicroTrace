import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { authorize, createUser } from "@/server/users";
import { resetDb } from "../../../test/db-reset";

const PASSWORD = "mot-de-passe-solide-1";

beforeEach(async () => {
  await resetDb();
});

describe("createUser", () => {
  it("crée un utilisateur avec e-mail en minuscules et hachage bcrypt de coût 12", async () => {
    const u = await createUser({ email: " Ana@Example.ORG ", name: "Ana", password: PASSWORD });
    expect(u.email).toBe("ana@example.org");
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(u.passwordHash).not.toContain(PASSWORD);
  });

  it("refuse un mot de passe de moins de 12 caractères", async () => {
    await expect(
      createUser({ email: "a@example.org", name: "A", password: "court" }),
    ).rejects.toThrow("Le mot de passe doit contenir au moins 12 caractères.");
  });

  it("refuse un e-mail en double", async () => {
    await createUser({ email: "a@example.org", name: "A", password: PASSWORD });
    await expect(
      createUser({ email: "A@example.org", name: "B", password: PASSWORD }),
    ).rejects.toThrow("Cette adresse e-mail est déjà utilisée.");
  });

  it("écrit un AuditEvent user.create sans mot de passe ni hachage", async () => {
    const u = await createUser({ email: "a@example.org", name: "A", password: PASSWORD });
    const events = await prisma.auditEvent.findMany({ where: { action: "user.create" } });
    expect(events).toHaveLength(1);
    expect(events[0].entityId).toBe(u.id);
    const text = JSON.stringify(events);
    expect(text).not.toContain(u.passwordHash);
    expect(text).not.toContain(PASSWORD);
    expect(text.toLowerCase()).not.toContain("password");
  });
});

describe("authorize", () => {
  it("renvoie l'utilisateur avec le bon mot de passe et audite user.login", async () => {
    const u = await createUser({ email: "a@example.org", name: "A", password: PASSWORD });
    const r = await authorize("A@example.org", PASSWORD);
    expect(r).toEqual({ id: u.id, name: "A", email: "a@example.org" });
    const events = await prisma.auditEvent.findMany({ where: { action: "user.login" } });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(u.id);
    const all = JSON.stringify(await prisma.auditEvent.findMany());
    expect(all).not.toContain(u.passwordHash);
  });

  it("renvoie null avec un mauvais mot de passe, sans audit", async () => {
    await createUser({ email: "a@example.org", name: "A", password: PASSWORD });
    expect(await authorize("a@example.org", "mauvais-mot-de-passe")).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "user.login" } })).toBe(0);
  });

  it("renvoie null pour un utilisateur inconnu", async () => {
    expect(await authorize("inconnu@example.org", PASSWORD)).toBeNull();
  });

  it("renvoie null pour un utilisateur inactif", async () => {
    const u = await createUser({ email: "a@example.org", name: "A", password: PASSWORD });
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    expect(await authorize("a@example.org", PASSWORD)).toBeNull();
  });

  it("compare un hachage factice pour un utilisateur inconnu (temps comparable)", async () => {
    await createUser({ email: "a@example.org", name: "A", password: PASSWORD });
    const t0 = performance.now();
    await authorize("a@example.org", "mauvais-mot-de-passe");
    const known = performance.now() - t0;
    const t1 = performance.now();
    await authorize("inconnu@example.org", "mauvais-mot-de-passe");
    const unknown = performance.now() - t1;
    expect(unknown).toBeGreaterThan(known * 0.4);
  });
});
