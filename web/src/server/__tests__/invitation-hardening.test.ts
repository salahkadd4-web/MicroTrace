import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ requireUser: vi.fn(), getOptionalUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "labo.example.test", "x-forwarded-proto": "https" })),
}));

import { reinviteFirstAdminAction } from "@/app/(app)/admin/actions";
import { prisma } from "@/server/db";
import {
  acceptInvitation,
  createFirstAdminInvitation,
  createInvitation,
  createLaboratoryWithFirstAdmin,
} from "@/server/invitations";
import type { LabContext } from "@/server/lab-context";
import { changeMemberRole } from "@/server/members";
import { listLaboratories } from "@/server/platform";
import { requireUser } from "@/server/session";
import { createUser } from "@/server/users";
import { resetDb } from "../../../test/db-reset";
import { makeLab, makeMember } from "../../../test/labs";

const INVALID = "Invitation invalide ou expirée.";
const LAST_ADMIN = "Le laboratoire doit garder au moins un responsable.";
const PASSWORD = "mot-de-passe-solide-1";

let lab: Awaited<ReturnType<typeof makeLab>>;
let admin: LabContext;

beforeEach(async () => {
  await resetDb();
  lab = await makeLab("Labo A", "labo-a");
  admin = await makeMember(lab, "lab_admin", "admin@example.org");
});

async function platformAdmin() {
  const u = await createUser({
    email: "plat@example.org",
    name: "Plat",
    password: PASSWORD,
    isPlatformAdmin: true,
  });
  return { id: u.id, name: u.name, email: u.email };
}

describe("usage unique : le garde de la transaction (course déterministe)", () => {
  /** Exécute `action` juste avant l'ouverture de la prochaine transaction : entre la validation du jeton et sa consommation. */
  function beforeNextTransaction(action: () => Promise<unknown>) {
    const original = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (...args: unknown[]) => {
      await action();
      return original(...args);
    }) as never);
  }

  it("révoquée entre la validation et la consommation (création de compte) : refus, ni compte ni membre", async () => {
    const { token, invitation } = await createInvitation(admin, { email: "n@example.org", role: "viewer" });
    beforeNextTransaction(() =>
      prisma.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } }),
    );
    await expect(acceptInvitation(token, { name: "N", password: PASSWORD })).rejects.toThrow(INVALID);
    expect(await prisma.user.count({ where: { email: "n@example.org" } })).toBe(0);
    expect(await prisma.membership.count({ where: { laboratoryId: lab.id } })).toBe(1);
    expect((await prisma.invitation.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("révoquée entre la validation et la consommation (rattachement) : refus, aucun membre", async () => {
    const u = await createUser({ email: "n@example.org", name: "N", password: PASSWORD });
    const { token, invitation } = await createInvitation(admin, { email: "n@example.org", role: "viewer" });
    beforeNextTransaction(() =>
      prisma.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } }),
    );
    await expect(
      acceptInvitation(token, { user: { id: u.id, name: u.name, email: u.email } }),
    ).rejects.toThrow(INVALID);
    expect(await prisma.membership.count({ where: { userId: u.id } })).toBe(0);
  });

  it("laboratoire suspendu entre la validation et la consommation : refus, ni compte ni membre", async () => {
    const { token } = await createInvitation(admin, { email: "n@example.org", role: "viewer" });
    beforeNextTransaction(() =>
      prisma.laboratory.update({ where: { id: lab.id }, data: { suspendedAt: new Date() } }),
    );
    await expect(acceptInvitation(token, { name: "N", password: PASSWORD })).rejects.toThrow(INVALID);
    expect(await prisma.user.count({ where: { email: "n@example.org" } })).toBe(0);
    expect((await prisma.invitation.findFirstOrThrow()).usedAt).toBeNull();
  });
});

describe("dernier responsable : fenêtre de concurrence déterministe", () => {
  it("une rétrogradation en cours (non validée) bloque la seconde, qui voit ensuite le dernier responsable", async () => {
    const second = await makeMember(lab, "lab_admin", "deux@example.org");
    const m1 = await prisma.membership.findFirstOrThrow({ where: { userId: admin.userId } });
    const m2 = await prisma.membership.findFirstOrThrow({ where: { userId: second.userId } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    // Première rétrogradation : verrou du laboratoire, écriture, puis attente avant validation.
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Laboratory" WHERE id = ${lab.id} FOR UPDATE`;
      await tx.membership.update({ where: { id: m1.id }, data: { role: "viewer" } });
      entered();
      await gate;
    });
    await inside;
    const racing = changeMemberRole(second, m2.id, "viewer");
    const settled = vi.fn();
    racing.then(settled, settled);
    // Attente bornée (5 s) d'un backend réellement bloqué sur un verrou, au lieu d'un délai fixe.
    let blocked = 0;
    for (let i = 0; i < 100 && blocked === 0; i++) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      blocked = Number(rows[0].n);
      if (blocked === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(blocked).toBeGreaterThan(0);
    expect(settled).not.toHaveBeenCalled(); // bloquée sur le verrou du laboratoire
    release();
    await holder;
    await expect(racing).rejects.toThrow(LAST_ADMIN);
    expect(
      await prisma.membership.count({ where: { laboratoryId: lab.id, role: "lab_admin" } }),
    ).toBe(1);
  });
});

describe("création atomique d'un laboratoire", () => {
  it("crée laboratoire, audit lab.create et invitation du responsable ensemble", async () => {
    const p = await platformAdmin();
    const r = await createLaboratoryWithFirstAdmin(p, { name: "Nouveau Labo", email: "Chef@Example.org" });
    const labRow = await prisma.laboratory.findUniqueOrThrow({ where: { id: r.laboratoryId } });
    expect(labRow.slug).toBe("nouveau-labo");
    const inv = await prisma.invitation.findFirstOrThrow({ where: { laboratoryId: labRow.id } });
    expect(inv).toMatchObject({ email: "chef@example.org", role: "lab_admin", invitedById: p.id });
    const actions = (await prisma.auditEvent.findMany({ where: { laboratoryId: labRow.id } }))
      .map((e) => e.action)
      .sort();
    expect(actions).toEqual(["invitation.create", "lab.create"]);
  });

  it("adresse invalide : aucun laboratoire, aucune invitation, aucun audit", async () => {
    const p = await platformAdmin();
    const labs = await prisma.laboratory.count();
    const audits = await prisma.auditEvent.count();
    await expect(
      createLaboratoryWithFirstAdmin(p, { name: "Orphelin", email: "pas-un-email" }),
    ).rejects.toThrow("Adresse e-mail invalide.");
    expect(await prisma.laboratory.count()).toBe(labs);
    expect(await prisma.auditEvent.count()).toBe(audits);
    expect(await prisma.invitation.count()).toBe(0);
  });

  it("réservé à la plateforme", async () => {
    await expect(
      createLaboratoryWithFirstAdmin(
        { id: admin.userId, name: "x", email: "admin@example.org" },
        { name: "Pirate", email: "x@example.org" },
      ),
    ).rejects.toThrow("Action réservée à l'équipe de la plateforme.");
    expect(await prisma.laboratory.count({ where: { name: "Pirate" } })).toBe(0);
  });

  it("createFirstAdminInvitation refuse un laboratoire qui a déjà un responsable, l'accepte sinon", async () => {
    const p = await platformAdmin();
    await expect(createFirstAdminInvitation(p, lab.id, "moi@example.org")).rejects.toThrow(
      "Ce laboratoire a déjà un responsable.",
    );
    expect(await prisma.invitation.count()).toBe(0);
    await prisma.membership.deleteMany({ where: { laboratoryId: lab.id, role: "lab_admin" } });
    const again = await createFirstAdminInvitation(p, lab.id, "moi@example.org");
    expect(again.invitation.role).toBe("lab_admin");
  });

  it("action « Nouvelle invitation du responsable » : 404 hors plateforme, refusée avec un responsable, permise sans", async () => {
    const NOT_FOUND = expect.objectContaining({ digest: expect.stringContaining("404") });
    const form = (labId: string) => {
      const f = new FormData();
      f.set("laboratoryId", labId);
      f.set("email", "moi@example.org");
      return f;
    };
    vi.mocked(requireUser).mockResolvedValue({ id: admin.userId, name: "a", email: "admin@example.org" });
    await expect(reinviteFirstAdminAction({}, form(lab.id))).rejects.toEqual(NOT_FOUND);
    vi.mocked(requireUser).mockResolvedValue(await platformAdmin());
    await expect(reinviteFirstAdminAction({}, form(lab.id))).resolves.toEqual({
      error: "Ce laboratoire a déjà un responsable.",
    });
    const empty = await makeLab("Vide", "vide");
    const r = await reinviteFirstAdminAction({}, form(empty.id));
    expect(r.link).toMatch(/^https:\/\/labo\.example\.test\/invitation\/[A-Za-z0-9_-]{43}$/);
  });

  it("listLaboratories : imports comptés par groupe, responsables comptés", async () => {
    const project = await prisma.project.create({
      data: { title: "P", ownerId: admin.userId, laboratoryId: lab.id },
    });
    const study = await prisma.study.create({
      data: { title: "E", projectId: project.id, laboratoryId: lab.id, nature: "laboratory" },
    });
    const file = await prisma.dataFile.create({
      data: {
        studyId: study.id,
        originalName: "f.csv",
        sha256: "a".repeat(64),
        sizeBytes: 1,
        mimeType: "text/csv",
        storagePath: "x",
        uploadedById: admin.userId,
      },
    });
    for (const status of ["retired", "active"] as const)
      await prisma.importRun.create({
        data: {
          studyId: study.id,
          dataFileId: file.id,
          mapping: {},
          frozenContext: {},
          issues: [],
          rulesVersion: "1",
          engineVersion: "1",
          createdById: admin.userId,
          status,
        },
      });
    await makeLab("Labo B", "labo-b");
    const rows = await listLaboratories(await platformAdmin());
    expect(rows.find((r) => r.slug === "labo-a")).toMatchObject({ imports: 2, admins: 1 });
    expect(rows.find((r) => r.slug === "labo-b")).toMatchObject({ imports: 0, admins: 0 });
  });
});
