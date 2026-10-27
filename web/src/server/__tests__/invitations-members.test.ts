import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import {
  acceptInvitation,
  createFirstAdminInvitation,
  createInvitation,
  previewInvitation,
} from "@/server/invitations";
import type { LabContext } from "@/server/lab-context";
import {
  changeMemberRole,
  listMembers,
  listPendingInvitations,
  removeMember,
  revokeInvitation,
} from "@/server/members";
import { listLaboratories, setLaboratorySuspended } from "@/server/platform";
import { createUser } from "@/server/users";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const ADMIN_ONLY = "Action réservée aux responsables du laboratoire.";
const INVALID = "Invitation invalide ou expirée.";
const LAST_ADMIN = "Le laboratoire doit garder au moins un responsable.";
const PASSWORD = "mot-de-passe-solide-1";

let lab: Awaited<ReturnType<typeof makeLab>>;
let other: Awaited<ReturnType<typeof makeLab>>;
let admin: LabContext;
let researcher: LabContext;
let otherAdmin: LabContext;

beforeEach(async () => {
  await resetDb();
  lab = await makeLab("Labo A", "labo-a");
  other = await makeLab("Labo B", "labo-b");
  admin = await makeMember(lab, "lab_admin", "admin@example.org");
  researcher = await makeMember(lab, "researcher", "cher@example.org");
  otherAdmin = await makeMember(other, "lab_admin", "admin-b@example.org");
});

async function invite(
  email = "nouveau@example.org",
  role: "researcher" | "viewer" | "lab_admin" = "researcher",
) {
  return createInvitation(admin, { email, role });
}

async function sessionUser(email: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email };
}

describe("createInvitation", () => {
  it("réservé aux responsables", async () => {
    await expect(
      createInvitation(researcher, { email: "x@example.org", role: "viewer" }),
    ).rejects.toThrow(ADMIN_ONLY);
    expect(await prisma.invitation.count()).toBe(0);
  });

  it("jeton de 32 octets en base64url ; seule l'empreinte SHA-256 est stockée ; échéance à 7 jours", async () => {
    const before = Date.now();
    const { invitation, token } = await invite("  Nouveau@Example.org ");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.email).toBe("nouveau@example.org");
    expect(row.role).toBe("researcher");
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const days = (row.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it("le jeton en clair et l'empreinte ne sont jamais en base (invitations ni audit)", async () => {
    const { token } = await invite();
    await acceptInvitation(token, { name: "Nouvelle", password: PASSWORD });
    const hash = (await prisma.invitation.findFirstOrThrow()).tokenHash;
    const audits = JSON.stringify(await prisma.auditEvent.findMany());
    expect(audits).not.toContain(token);
    expect(audits).not.toContain(hash);
    const rows = await prisma.$queryRawUnsafe<{ t: string }[]>(
      `SELECT row_to_json(i)::text AS t FROM "Invitation" i`,
    );
    expect(rows.some((r) => r.t.includes(token))).toBe(false);
    const events = await prisma.auditEvent.findMany({ where: { action: "invitation.create" } });
    expect(events).toHaveLength(1);
    expect(events[0].laboratoryId).toBe(lab.id);
    expect(events[0].after).toMatchObject({ email: "nouveau@example.org", role: "researcher" });
    expect(JSON.stringify(events[0].after)).toContain("expiresAt");
  });

  it("adresse invalide, ou déjà membre : refus sans écriture", async () => {
    await expect(
      createInvitation(admin, { email: "pas-un-email", role: "viewer" }),
    ).rejects.toThrow("Adresse e-mail invalide.");
    await expect(
      createInvitation(admin, { email: "CHER@example.org", role: "viewer" }),
    ).rejects.toThrow("Cette personne est déjà membre du laboratoire.");
    expect(await prisma.invitation.count()).toBe(0);
  });

  it("une nouvelle invitation révoque la précédente en attente (même laboratoire et e-mail)", async () => {
    const first = await invite();
    const foreign = await createInvitation(otherAdmin, {
      email: "nouveau@example.org",
      role: "viewer",
    });
    const second = await invite();
    const rows = await prisma.invitation.findMany();
    expect(rows.find((r) => r.id === first.invitation.id)?.revokedAt).not.toBeNull();
    expect(rows.find((r) => r.id === second.invitation.id)?.revokedAt).toBeNull();
    expect(rows.find((r) => r.id === foreign.invitation.id)?.revokedAt).toBeNull();
    await expect(
      acceptInvitation(first.token, { name: "X", password: PASSWORD }),
    ).rejects.toThrow(INVALID);
  });
});

describe("acceptInvitation", () => {
  it("crée le compte et le membre avec le bon rôle, en une fois ; audit sans jeton", async () => {
    const { token } = await invite("nouveau@example.org", "viewer");
    const r = await acceptInvitation(token, { name: "Nouvelle", password: PASSWORD });
    expect(r.labSlug).toBe("labo-a");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "nouveau@example.org" } });
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    expect(m).toMatchObject({ laboratoryId: lab.id, role: "viewer" });
    expect((await prisma.invitation.findFirstOrThrow()).usedAt).not.toBeNull();
    const ev = await prisma.auditEvent.findMany({ where: { action: "invitation.accept" } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ laboratoryId: lab.id, actorId: user.id });
  });

  it("une seconde utilisation est refusée", async () => {
    const { token } = await invite();
    await acceptInvitation(token, { name: "Nouvelle", password: PASSWORD });
    await expect(acceptInvitation(token, { name: "Bis", password: PASSWORD })).rejects.toThrow(
      INVALID,
    );
    expect(await prisma.user.count({ where: { email: "nouveau@example.org" } })).toBe(1);
  });

  it("expirée, révoquée, inconnue ou laboratoire suspendu : refus", async () => {
    const a = await invite("a@example.org");
    await prisma.invitation.update({
      where: { id: a.invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(acceptInvitation(a.token, { name: "A", password: PASSWORD })).rejects.toThrow(
      INVALID,
    );

    const b = await invite("b@example.org");
    await revokeInvitation(admin, b.invitation.id);
    await expect(acceptInvitation(b.token, { name: "B", password: PASSWORD })).rejects.toThrow(
      INVALID,
    );

    await expect(
      acceptInvitation("inconnu", { name: "C", password: PASSWORD }),
    ).rejects.toThrow(INVALID);

    const d = await invite("d@example.org");
    await prisma.laboratory.update({ where: { id: lab.id }, data: { suspendedAt: new Date() } });
    await expect(acceptInvitation(d.token, { name: "D", password: PASSWORD })).rejects.toThrow(
      INVALID,
    );
    expect(
      await prisma.user.count({
        where: { email: { in: ["a@example.org", "b@example.org", "d@example.org"] } },
      }),
    ).toBe(0);
  });

  it("mot de passe trop court ou trop long : refus, invitation non consommée", async () => {
    const { token } = await invite();
    await expect(acceptInvitation(token, { name: "N", password: "court" })).rejects.toThrow(
      "au moins 12",
    );
    await expect(
      acceptInvitation(token, { name: "N", password: "é".repeat(40) }),
    ).rejects.toThrow("72 octets");
    expect((await prisma.invitation.findFirstOrThrow()).usedAt).toBeNull();
    await acceptInvitation(token, { name: "N", password: PASSWORD });
  });

  it("un compte existe déjà pour l'adresse : refus du formulaire de création", async () => {
    await createUser({ email: "nouveau@example.org", name: "Déjà", password: PASSWORD });
    const { token } = await invite();
    await expect(acceptInvitation(token, { name: "X", password: PASSWORD })).rejects.toThrow(
      "Un compte existe déjà pour cette adresse : connectez-vous puis rouvrez le lien.",
    );
    expect((await prisma.invitation.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("connecté avec la même adresse : rattache l'utilisateur", async () => {
    await createUser({ email: "nouveau@example.org", name: "Déjà", password: PASSWORD });
    const { token } = await invite("nouveau@example.org", "lab_admin");
    const r = await acceptInvitation(token, { user: await sessionUser("nouveau@example.org") });
    expect(r.labSlug).toBe("labo-a");
    const u = await sessionUser("nouveau@example.org");
    expect(
      await prisma.membership.findFirstOrThrow({
        where: { userId: u.id, laboratoryId: lab.id },
      }),
    ).toMatchObject({ role: "lab_admin" });
  });

  it("connecté avec une autre adresse : refus", async () => {
    const { token } = await invite();
    await expect(
      acceptInvitation(token, { user: await sessionUser("cher@example.org") }),
    ).rejects.toThrow("Cette invitation est destinée à une autre adresse e-mail.");
    expect((await prisma.invitation.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("déjà membre : rien n'est consommé", async () => {
    const { token } = await invite("tard@example.org");
    const late = await createUser({ email: "tard@example.org", name: "Tard", password: PASSWORD });
    await prisma.membership.create({
      data: { userId: late.id, laboratoryId: lab.id, role: "viewer" },
    });
    await expect(
      acceptInvitation(token, { user: { id: late.id, name: late.name, email: late.email } }),
    ).rejects.toThrow("Vous êtes déjà membre de ce laboratoire.");
    expect((await prisma.invitation.findFirstOrThrow()).usedAt).toBeNull();
    expect(await prisma.membership.count({ where: { userId: late.id } })).toBe(1);
  });

  it("deux acceptations simultanées du même jeton : une seule réussit", async () => {
    const { token } = await invite();
    const results = await Promise.allSettled([
      acceptInvitation(token, { name: "Un", password: PASSWORD }),
      acceptInvitation(token, { name: "Deux", password: PASSWORD }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.membership.count({
        where: { laboratoryId: lab.id, user: { email: "nouveau@example.org" } },
      }),
    ).toBe(1);
  });

  it("deux rattachements simultanés du même jeton : une seule réussit", async () => {
    const u = await createUser({ email: "nouveau@example.org", name: "N", password: PASSWORD });
    const { token } = await invite();
    const user = { id: u.id, name: u.name, email: u.email };
    const results = await Promise.allSettled([
      acceptInvitation(token, { user }),
      acceptInvitation(token, { user }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "invitation.accept" } })).toBe(1);
  });
});

describe("previewInvitation", () => {
  it("renvoie l'état de la page selon l'utilisateur", async () => {
    const { token } = await invite();
    expect(await previewInvitation(token, null)).toMatchObject({
      state: "signup",
      email: "nouveau@example.org",
      labName: "Labo A",
    });
    expect(await previewInvitation("faux", null)).toEqual({ state: "invalid" });
    expect(await previewInvitation(token, await sessionUser("cher@example.org"))).toMatchObject({
      state: "wrong-email",
    });
    await createUser({ email: "nouveau@example.org", name: "N", password: PASSWORD });
    expect(await previewInvitation(token, null)).toMatchObject({ state: "login-required" });
    expect(
      await previewInvitation(token, await sessionUser("nouveau@example.org")),
    ).toMatchObject({ state: "join" });
    const u = await sessionUser("nouveau@example.org");
    await prisma.membership.create({
      data: { userId: u.id, laboratoryId: lab.id, role: "viewer" },
    });
    expect(await previewInvitation(token, u)).toMatchObject({ state: "already-member" });
  });
});

describe("membres", () => {
  it("un chercheur ne peut ni lister ni gérer", async () => {
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: researcher.userId } });
    const inv = await invite();
    await expect(listMembers(researcher)).rejects.toThrow(ADMIN_ONLY);
    await expect(listPendingInvitations(researcher)).rejects.toThrow(ADMIN_ONLY);
    await expect(changeMemberRole(researcher, m.id, "lab_admin")).rejects.toThrow(ADMIN_ONLY);
    await expect(removeMember(researcher, m.id)).rejects.toThrow(ADMIN_ONLY);
    await expect(revokeInvitation(researcher, inv.invitation.id)).rejects.toThrow(ADMIN_ONLY);
  });

  it("listMembers et listPendingInvitations restent dans le laboratoire", async () => {
    await invite("a@example.org");
    await createInvitation(otherAdmin, { email: "b@example.org", role: "viewer" });
    expect((await listMembers(admin)).map((m) => m.email).sort()).toEqual([
      "admin@example.org",
      "cher@example.org",
    ]);
    const pending = await listPendingInvitations(admin);
    expect(pending.map((p) => p.email)).toEqual(["a@example.org"]);
    expect(JSON.stringify(pending)).not.toContain("tokenHash");
  });

  it("change le rôle et retire un membre, avec audit", async () => {
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: researcher.userId } });
    await changeMemberRole(admin, m.id, "viewer");
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).role).toBe(
      "viewer",
    );
    await removeMember(admin, m.id);
    expect(await prisma.membership.count({ where: { id: m.id } })).toBe(0);
    const actions = (await prisma.auditEvent.findMany({ where: { entityId: m.id } }))
      .map((e) => e.action)
      .sort();
    expect(actions).toEqual(["member.remove", "member.role.change"]);
  });

  it("rôle inconnu refusé", async () => {
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: researcher.userId } });
    await expect(changeMemberRole(admin, m.id, "root" as never)).rejects.toThrow(
      "Rôle invalide.",
    );
  });

  it("le dernier responsable ne peut être ni retiré ni rétrogradé", async () => {
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: admin.userId } });
    await expect(changeMemberRole(admin, m.id, "viewer")).rejects.toThrow(LAST_ADMIN);
    await expect(removeMember(admin, m.id)).rejects.toThrow(LAST_ADMIN);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).role).toBe(
      "lab_admin",
    );
  });

  it("deux rétrogradations simultanées des deux responsables en laissent un", async () => {
    const second = await makeMember(lab, "lab_admin", "deux@example.org");
    const m1 = await prisma.membership.findFirstOrThrow({ where: { userId: admin.userId } });
    const m2 = await prisma.membership.findFirstOrThrow({ where: { userId: second.userId } });
    const results = await Promise.allSettled([
      changeMemberRole(admin, m1.id, "viewer"),
      changeMemberRole(second, m2.id, "viewer"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.membership.count({ where: { laboratoryId: lab.id, role: "lab_admin" } }),
    ).toBe(1);
  });

  it("un identifiant d'un autre laboratoire est introuvable, rien ne change", async () => {
    const foreignMember = await prisma.membership.findFirstOrThrow({
      where: { userId: otherAdmin.userId },
    });
    const foreignInv = await createInvitation(otherAdmin, {
      email: "x@example.org",
      role: "viewer",
    });
    const snap = async () =>
      JSON.stringify([
        await prisma.membership.findMany({ orderBy: { id: "asc" } }),
        await prisma.invitation.findMany({ orderBy: { id: "asc" } }),
        await prisma.auditEvent.count(),
      ]);
    const before = await snap();
    for (const id of [foreignMember.id, "inexistant"]) {
      await expect(changeMemberRole(admin, id, "viewer")).rejects.toThrow("Membre introuvable.");
      await expect(removeMember(admin, id)).rejects.toThrow("Membre introuvable.");
    }
    for (const id of [foreignInv.invitation.id, "inexistant"]) {
      await expect(revokeInvitation(admin, id)).rejects.toThrow("Invitation introuvable.");
    }
    expect(await snap()).toBe(before);
  });

  it("révoquer une invitation : audit, plus en attente ; déjà révoquée = introuvable", async () => {
    const { invitation } = await invite();
    await revokeInvitation(admin, invitation.id);
    expect(await listPendingInvitations(admin)).toEqual([]);
    await expect(revokeInvitation(admin, invitation.id)).rejects.toThrow(
      "Invitation introuvable.",
    );
    expect(
      await prisma.auditEvent.count({
        where: { action: "invitation.revoke", laboratoryId: lab.id },
      }),
    ).toBe(1);
  });
});

describe("plateforme", () => {
  async function platformAdmin() {
    const u = await createUser({
      email: "plat@example.org",
      name: "Plat",
      password: PASSWORD,
      isPlatformAdmin: true,
    });
    return { id: u.id, name: u.name, email: u.email };
  }

  it("createFirstAdminInvitation : réservé à la plateforme, rôle responsable", async () => {
    await expect(
      createFirstAdminInvitation(await sessionUser("admin@example.org"), lab.id, "p@example.org"),
    ).rejects.toThrow("Action réservée à l'équipe de la plateforme.");
    const p = await platformAdmin();
    const empty = await makeLab("Labo vide", "labo-vide");
    const { token, invitation } = await createFirstAdminInvitation(
      p,
      empty.id,
      "premier@example.org",
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row).toMatchObject({ role: "lab_admin", laboratoryId: empty.id, invitedById: p.id });
    await expect(createFirstAdminInvitation(p, "inconnu", "z@example.org")).rejects.toThrow(
      "Laboratoire introuvable.",
    );
  });

  it("suspension et réactivation : audit rattaché au laboratoire, réservé à la plateforme", async () => {
    const p = await platformAdmin();
    await expect(
      setLaboratorySuspended(await sessionUser("admin@example.org"), lab.id, true),
    ).rejects.toThrow("Action réservée à l'équipe de la plateforme.");
    await setLaboratorySuspended(p, lab.id, true);
    expect(
      (await prisma.laboratory.findUniqueOrThrow({ where: { id: lab.id } })).suspendedAt,
    ).not.toBeNull();
    await setLaboratorySuspended(p, lab.id, false);
    expect(
      (await prisma.laboratory.findUniqueOrThrow({ where: { id: lab.id } })).suspendedAt,
    ).toBeNull();
    const events = await prisma.auditEvent.findMany({
      where: { action: { in: ["lab.suspend", "lab.reactivate"] } },
    });
    expect(events.map((e) => e.action).sort()).toEqual(["lab.reactivate", "lab.suspend"]);
    expect(events.every((e) => e.laboratoryId === lab.id)).toBe(true);
    await expect(setLaboratorySuspended(p, "inconnu", true)).rejects.toThrow(
      "Laboratoire introuvable.",
    );
  });

  it("la liste ne contient que des compteurs : aucun titre d'étude ni valeur", async () => {
    const project = await prisma.project.create({
      data: { title: "Projet secret", ownerId: admin.userId, laboratoryId: lab.id },
    });
    await prisma.study.create({
      data: {
        title: "Étude confidentielle XYZ",
        projectId: project.id,
        laboratoryId: lab.id,
        nature: "laboratory",
      },
    });
    const p = await platformAdmin();
    const rows = await listLaboratories(p);
    const a = rows.find((r) => r.slug === "labo-a");
    expect(a).toMatchObject({ members: 2, studies: 1, imports: 0, suspended: false });
    const json = JSON.stringify(rows);
    expect(json).not.toContain("confidentielle");
    expect(json).not.toContain("secret");
    await expect(listLaboratories(await sessionUser("admin@example.org"))).rejects.toThrow();
  });
});
