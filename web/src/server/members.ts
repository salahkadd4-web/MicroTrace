import "server-only";
import type { LabRole } from "@/generated/prisma/enums";
import { recordAudit, type Tx } from "@/server/audit";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import type { LabContext } from "@/server/lab-context";
import { assertRole, parseLabRole } from "@/server/lab-role";
import { lockLaboratory } from "@/server/tx-lock";

const LAST_ADMIN = "Le laboratoire doit garder au moins un responsable.";

export type MemberView = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: LabRole;
  createdAt: Date;
};

export type PendingInvitationView = {
  id: string;
  email: string;
  role: LabRole;
  expiresAt: Date;
  createdAt: Date;
};

/** Membres du laboratoire (responsables seulement). */
export async function listMembers(ctx: LabContext): Promise<MemberView[]> {
  assertRole(ctx, "lab_admin");
  const rows = await prisma.membership.findMany({
    where: { laboratoryId: ctx.laboratoryId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    createdAt: m.createdAt,
  }));
}

/** Invitations en attente (ni utilisées, ni révoquées, ni expirées) ; jamais le jeton ni son empreinte. */
export async function listPendingInvitations(ctx: LabContext): Promise<PendingInvitationView[]> {
  assertRole(ctx, "lab_admin");
  return prisma.invitation.findMany({
    where: {
      laboratoryId: ctx.laboratoryId,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function revokeInvitation(ctx: LabContext, invitationId: string): Promise<void> {
  assertRole(ctx, "lab_admin");
  await prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.findFirst({
      where: { id: invitationId, laboratoryId: ctx.laboratoryId, usedAt: null, revokedAt: null },
      select: { id: true, email: true, role: true },
    });
    if (!inv) throw new DomainError("Invitation introuvable.");
    const now = new Date();
    const { count } = await tx.invitation.updateMany({
      where: { id: inv.id, laboratoryId: ctx.laboratoryId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    if (count !== 1) throw new DomainError("Invitation introuvable.");
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "invitation.revoke",
      entityType: "Invitation",
      entityId: inv.id,
      before: { email: inv.email, role: inv.role },
      after: { email: inv.email, role: inv.role, revokedAt: now.toISOString() },
      laboratoryId: ctx.laboratoryId,
    });
  });
}

export async function changeMemberRole(
  ctx: LabContext,
  membershipId: string,
  role: string,
): Promise<void> {
  assertRole(ctx, "lab_admin");
  const next = parseLabRole(role);
  await prisma.$transaction(async (tx) => {
    await lockLaboratory(tx, ctx.laboratoryId);
    const m = await tx.membership.findFirst({
      where: { id: membershipId, laboratoryId: ctx.laboratoryId },
      include: { user: { select: { email: true } } },
    });
    if (!m) throw new DomainError("Membre introuvable.");
    if (m.role === next) return;
    if (m.role === "lab_admin") await assertAnotherAdmin(tx, ctx.laboratoryId, m.id);
    await tx.membership.updateMany({
      where: { id: m.id, laboratoryId: ctx.laboratoryId },
      data: { role: next },
    });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "member.role.change",
      entityType: "Membership",
      entityId: m.id,
      before: { email: m.user.email, role: m.role },
      after: { email: m.user.email, role: next },
      laboratoryId: ctx.laboratoryId,
    });
  });
}

export async function removeMember(ctx: LabContext, membershipId: string): Promise<void> {
  assertRole(ctx, "lab_admin");
  await prisma.$transaction(async (tx) => {
    await lockLaboratory(tx, ctx.laboratoryId);
    const m = await tx.membership.findFirst({
      where: { id: membershipId, laboratoryId: ctx.laboratoryId },
      include: { user: { select: { email: true } } },
    });
    if (!m) throw new DomainError("Membre introuvable.");
    if (m.role === "lab_admin") await assertAnotherAdmin(tx, ctx.laboratoryId, m.id);
    await tx.membership.deleteMany({ where: { id: m.id, laboratoryId: ctx.laboratoryId } });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "member.remove",
      entityType: "Membership",
      entityId: m.id,
      before: { email: m.user.email, role: m.role },
      laboratoryId: ctx.laboratoryId,
    });
  });
}

/** Refuse si `excludedId` est le dernier responsable (calculé dans la transaction, laboratoire verrouillé). */
async function assertAnotherAdmin(tx: Tx, laboratoryId: string, excludedId: string): Promise<void> {
  const others = await tx.membership.count({
    where: { laboratoryId, role: "lab_admin", id: { not: excludedId } },
  });
  if (others === 0) throw new DomainError(LAST_ADMIN);
}
