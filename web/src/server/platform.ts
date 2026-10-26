import "server-only";
import { recordAudit, type Tx } from "@/server/audit";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import type { SessionUser } from "@/server/users";

export const PLATFORM_ONLY = "Action réservée à l'équipe de la plateforme.";

/** Équipe de la plateforme, relue en base dans la transaction de l'appelant. */
export async function assertPlatformAdmin(
  db: Pick<Tx, "user">,
  admin: SessionUser,
): Promise<void> {
  const actor = await db.user.findUnique({
    where: { id: admin.id },
    select: { isPlatformAdmin: true, active: true },
  });
  if (!actor?.active || !actor.isPlatformAdmin) throw new DomainError(PLATFORM_ONLY);
}

export type ConsoleLaboratory = {
  id: string;
  name: string;
  slug: string;
  suspended: boolean;
  createdAt: Date;
  members: number;
  studies: number;
  imports: number;
};

/**
 * Laboratoires avec leurs seuls compteurs (membres, études, imports) : la console de la
 * plateforme ne lit aucun titre, aucune valeur ni aucune donnée scientifique.
 */
export async function listLaboratories(admin: SessionUser): Promise<ConsoleLaboratory[]> {
  await assertPlatformAdmin(prisma, admin);
  const labs = await prisma.laboratory.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      suspendedAt: true,
      createdAt: true,
      _count: { select: { memberships: true, studies: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return Promise.all(
    labs.map(async (l) => ({
      id: l.id,
      name: l.name,
      slug: l.slug,
      suspended: l.suspendedAt !== null,
      createdAt: l.createdAt,
      members: l._count.memberships,
      studies: l._count.studies,
      imports: await prisma.importRun.count({ where: { study: { laboratoryId: l.id } } }),
    })),
  );
}

/** Suspend ou réactive un laboratoire (audit rattaché à ce laboratoire). */
export async function setLaboratorySuspended(
  admin: SessionUser,
  laboratoryId: string,
  suspended: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertPlatformAdmin(tx, admin);
    const lab = await tx.laboratory.findUnique({
      where: { id: laboratoryId },
      select: { id: true, suspendedAt: true },
    });
    if (!lab) throw new DomainError("Laboratoire introuvable.");
    if (suspended === (lab.suspendedAt !== null))
      throw new DomainError(suspended ? "Laboratoire déjà suspendu." : "Laboratoire déjà actif.");
    const at = suspended ? new Date() : null;
    await tx.laboratory.update({ where: { id: lab.id }, data: { suspendedAt: at } });
    await recordAudit(tx, {
      actorId: admin.id,
      action: suspended ? "lab.suspend" : "lab.reactivate",
      entityType: "Laboratory",
      entityId: lab.id,
      before: { suspendedAt: lab.suspendedAt?.toISOString() ?? null },
      after: { suspendedAt: at?.toISOString() ?? null },
      laboratoryId: lab.id,
    });
  });
}
