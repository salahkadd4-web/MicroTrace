import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn(), getOptionalUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "labo.example.test", "x-forwarded-proto": "https" })),
}));

import { prisma } from "@/server/db";
import { getOptionalUser, requireUser } from "@/server/session";
import { createUser } from "@/server/users";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";
import { acceptInvitationAction } from "@/app/invitation/[token]/actions";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/app/(app)/labo/[labSlug]/membres/actions";
import { createLaboratoryAction, setSuspendedAction } from "@/app/(app)/admin/actions";

const NOT_FOUND = expect.objectContaining({ digest: expect.stringContaining("404") });
const PASSWORD = "mot-de-passe-solide-1";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function login(email: string | null) {
  if (!email) {
    vi.mocked(getOptionalUser).mockResolvedValue(null);
    return;
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  const su = { id: u.id, name: u.name, email: u.email };
  vi.mocked(requireUser).mockResolvedValue(su);
  vi.mocked(getOptionalUser).mockResolvedValue(su);
}

async function redirectTarget(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return String((e as { digest?: string }).digest).split(";")[2];
  }
  throw new Error("aucune redirection");
}

beforeEach(async () => {
  await resetDb();
  delete process.env.APP_URL;
});

describe("actions de la page Membres", () => {
  it("un responsable invite : le lien complet est renvoyé, dérivé de l'en-tête Host", async () => {
    const lab = await makeLab("Labo A", "labo-a");
    await makeMember(lab, "lab_admin", "admin@example.org");
    await login("admin@example.org");
    const r = await inviteMemberAction("labo-a", {}, form({ email: "x@example.org", role: "viewer" }));
    expect(r.link).toMatch(/^https:\/\/labo\.example\.test\/invitation\/[A-Za-z0-9_-]{43}$/);
  });

  it("APP_URL a la priorité sur l'en-tête", async () => {
    process.env.APP_URL = "https://app.microtrace.test/";
    const lab = await makeLab("Labo A", "labo-a");
    await makeMember(lab, "lab_admin", "admin@example.org");
    await login("admin@example.org");
    const r = await inviteMemberAction("labo-a", {}, form({ email: "x@example.org", role: "viewer" }));
    expect(r.link).toMatch(/^https:\/\/app\.microtrace\.test\/invitation\//);
  });

  it("un chercheur est refusé sans écriture ; un non-membre reçoit un 404", async () => {
    const a = await makeLab("Labo A", "labo-a");
    const b = await makeLab("Labo B", "labo-b");
    await makeMember(a, "researcher", "cher@example.org");
    await makeMember(b, "lab_admin", "admin-b@example.org");
    await login("cher@example.org");
    await expect(
      inviteMemberAction("labo-a", {}, form({ email: "x@example.org", role: "viewer" })),
    ).resolves.toEqual({ error: "Action réservée aux responsables du laboratoire." });
    await expect(
      inviteMemberAction("labo-b", {}, form({ email: "x@example.org", role: "viewer" })),
    ).rejects.toEqual(NOT_FOUND);
    expect(await prisma.invitation.count()).toBe(0);
  });

  it("changer, retirer et révoquer passent par le laboratoire du slug (identifiants étrangers introuvables)", async () => {
    const a = await makeLab("Labo A", "labo-a");
    const b = await makeLab("Labo B", "labo-b");
    await makeMember(a, "lab_admin", "admin@example.org");
    await makeMember(b, "lab_admin", "admin-b@example.org");
    await login("admin@example.org");
    const foreign = await prisma.membership.findFirstOrThrow({ where: { laboratoryId: b.id } });
    await expect(changeRoleAction("labo-a", foreign.id, "viewer")).resolves.toEqual({
      error: "Membre introuvable.",
    });
    await expect(removeMemberAction("labo-a", foreign.id)).resolves.toEqual({
      error: "Membre introuvable.",
    });
    await expect(revokeInvitationAction("labo-a", "x")).resolves.toEqual({
      error: "Invitation introuvable.",
    });
    const own = await prisma.membership.findFirstOrThrow({ where: { laboratoryId: a.id } });
    await expect(removeMemberAction("labo-a", own.id)).resolves.toEqual({
      error: "Le laboratoire doit garder au moins un responsable.",
    });
  });
});

describe("auto-rétrogradation et auto-retrait", () => {
  async function twoAdmins() {
    const lab = await makeLab("Labo A", "labo-a");
    await makeMember(lab, "lab_admin", "admin@example.org");
    await makeMember(lab, "lab_admin", "second@example.org");
    await login("admin@example.org");
    return prisma.membership.findFirstOrThrow({ where: { user: { email: "admin@example.org" } } });
  }

  it("se rétrograder redirige vers la liste des projets", async () => {
    const own = await twoAdmins();
    expect(await redirectTarget(changeRoleAction("labo-a", own.id, "researcher"))).toBe(
      "/labo/labo-a/projets",
    );
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: own.id } })).role).toBe("researcher");
  });

  it("se retirer redirige vers l'accueil", async () => {
    const own = await twoAdmins();
    expect(await redirectTarget(removeMemberAction("labo-a", own.id))).toBe("/");
    expect(await prisma.membership.count({ where: { id: own.id } })).toBe(0);
  });

  it("modifier un autre membre ne redirige pas", async () => {
    await twoAdmins();
    const other = await prisma.membership.findFirstOrThrow({ where: { user: { email: "second@example.org" } } });
    await expect(changeRoleAction("labo-a", other.id, "viewer")).resolves.toEqual({ ok: true });
  });

  it("un refus (dernier responsable) ne redirige pas", async () => {
    const lab = await makeLab("Labo B", "labo-b");
    await makeMember(lab, "lab_admin", "seul@example.org");
    await login("seul@example.org");
    const own = await prisma.membership.findFirstOrThrow({ where: { user: { email: "seul@example.org" } } });
    await expect(changeRoleAction("labo-b", own.id, "viewer")).resolves.toEqual({
      error: "Le laboratoire doit garder au moins un responsable.",
    });
  });
});

describe("action d'acceptation", () => {
  async function invitation(email: string, role: "researcher" | "viewer" = "researcher") {
    const lab = await prisma.laboratory.findUniqueOrThrow({ where: { slug: "labo-a" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.org" } });
    const { createInvitation } = await import("@/server/invitations");
    return createInvitation(
      {
        userId: admin.id,
        userName: admin.name,
        laboratoryId: lab.id,
        labSlug: lab.slug,
        labName: lab.name,
        role: "lab_admin",
      } as never,
      { email, role },
    );
  }

  beforeEach(async () => {
    const lab = await makeLab("Labo A", "labo-a");
    await makeMember(lab, "lab_admin", "admin@example.org");
  });

  it("non connecté : crée le compte et renvoie à la connexion avec l'indicateur, sans e-mail dans l'URL", async () => {
    const { token } = await invitation("nouvelle@example.org");
    await login(null);
    const target = await redirectTarget(
      acceptInvitationAction(token, {}, form({ name: "Nouvelle", password: PASSWORD })),
    );
    expect(target).toBe("/connexion?callbackUrl=/labo/labo-a/projets&compte=cree");
    expect(target).not.toContain("nouvelle");
    expect(target).not.toContain(token);
    expect(await prisma.user.count({ where: { email: "nouvelle@example.org" } })).toBe(1);
  });

  it("jeton invalide : message sans le jeton", async () => {
    await login(null);
    const r = await acceptInvitationAction("jeton-inconnu-123", {}, form({ name: "N", password: PASSWORD }));
    expect(r).toEqual({ error: "Invitation invalide ou expirée." });
    expect(JSON.stringify(r)).not.toContain("jeton-inconnu-123");
  });

  it("mot de passe trop court : erreur de formulaire, invitation intacte", async () => {
    const { token } = await invitation("nouvelle@example.org");
    await login(null);
    const r = await acceptInvitationAction(token, {}, form({ name: "N", password: "court" }));
    expect(r.error).toMatch(/au moins 12/);
    expect((await prisma.invitation.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("connecté avec la même adresse : rejoint le laboratoire", async () => {
    await createUser({ email: "deja@example.org", name: "Déjà", password: PASSWORD });
    const { token } = await invitation("deja@example.org", "viewer");
    await login("deja@example.org");
    const target = await redirectTarget(acceptInvitationAction(token, {}, form({})));
    expect(target).toBe("/labo/labo-a/projets");
    expect(
      await prisma.membership.count({ where: { user: { email: "deja@example.org" }, role: "viewer" } }),
    ).toBe(1);
  });

  it("connecté avec une autre adresse : refus", async () => {
    const { token } = await invitation("deja@example.org");
    await login("admin@example.org");
    await expect(acceptInvitationAction(token, {}, form({}))).resolves.toEqual({
      error: "Cette invitation est destinée à une autre adresse e-mail.",
    });
  });
});

describe("actions de la console", () => {
  it("un non-administrateur reçoit un 404 et rien n'est écrit", async () => {
    const lab = await makeLab("Labo A", "labo-a");
    await makeMember(lab, "lab_admin", "admin@example.org");
    await login("admin@example.org");
    await expect(
      createLaboratoryAction({}, form({ name: "Pirate", email: "p@example.org" })),
    ).rejects.toEqual(NOT_FOUND);
    await expect(setSuspendedAction(lab.id, true)).rejects.toEqual(NOT_FOUND);
    expect(await prisma.laboratory.count()).toBe(1);
  });

  it("l'équipe crée un laboratoire et l'invitation de son premier responsable, le lien est renvoyé", async () => {
    await createUser({ email: "plat@example.org", name: "Plat", password: PASSWORD, isPlatformAdmin: true });
    await login("plat@example.org");
    const r = await createLaboratoryAction({}, form({ name: "Nouveau Labo", email: "Premier@Example.org" }));
    expect(r.link).toMatch(/\/invitation\/[A-Za-z0-9_-]{43}$/);
    const lab = await prisma.laboratory.findFirstOrThrow({ where: { name: "Nouveau Labo" } });
    const inv = await prisma.invitation.findFirstOrThrow({ where: { laboratoryId: lab.id } });
    expect(inv).toMatchObject({ email: "premier@example.org", role: "lab_admin" });
    expect(await prisma.auditEvent.count({ where: { action: "lab.create", laboratoryId: lab.id } })).toBe(1);
  });

  it("adresse invalide : aucun laboratoire créé", async () => {
    await createUser({ email: "plat@example.org", name: "Plat", password: PASSWORD, isPlatformAdmin: true });
    await login("plat@example.org");
    await expect(createLaboratoryAction({}, form({ name: "X", email: "pas-un-email" }))).resolves.toEqual({
      error: "Adresse e-mail invalide.",
    });
    expect(await prisma.laboratory.count()).toBe(0);
  });

  it("suspension puis réactivation", async () => {
    const lab = await makeLab("Labo A", "labo-a");
    await createUser({ email: "plat@example.org", name: "Plat", password: PASSWORD, isPlatformAdmin: true });
    await login("plat@example.org");
    await expect(setSuspendedAction(lab.id, true)).resolves.toEqual({ ok: true });
    expect((await prisma.laboratory.findUniqueOrThrow({ where: { id: lab.id } })).suspendedAt).not.toBeNull();
    await expect(setSuspendedAction(lab.id, false)).resolves.toEqual({ ok: true });
    expect((await prisma.laboratory.findUniqueOrThrow({ where: { id: lab.id } })).suspendedAt).toBeNull();
  });
});
