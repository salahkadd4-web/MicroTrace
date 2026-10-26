import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

export type Tx = Prisma.TransactionClient;

export type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  /** Laboratoire de l'événement ; absent pour les événements de la plateforme. */
  laboratoryId?: string | null;
};

/** Écrit un AuditEvent dans la transaction de l'appelant (journal en ajout seul). */
export async function recordAudit(tx: Tx, e: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId: e.actorId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: e.before,
      after: e.after,
      laboratoryId: e.laboratoryId ?? null,
    },
  });
}

const MAX_EVENTS = 500;

export type AuditEventView = {
  id: string;
  createdAt: Date;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
};

/**
 * Événements de l'étude et de ses objets (méthodes, limites, contrôles qualité), du plus récent
 * au plus ancien. Les limites supprimées sont retrouvées par le `studyId` du `before` de leur
 * suppression.
 */
export async function listAuditEvents(studyId: string): Promise<AuditEventView[]> {
  const [methods, limits, qcs, removals] = await Promise.all([
    prisma.method.findMany({ where: { studyId }, select: { id: true } }),
    prisma.detectionLimit.findMany({ where: { studyId }, select: { id: true } }),
    prisma.qualityControlSummary.findMany({ where: { studyId }, select: { id: true } }),
    prisma.auditEvent.findMany({
      where: {
        entityType: "DetectionLimit",
        action: "study.limit.remove",
        before: { path: ["studyId"], equals: studyId },
      },
      select: { entityId: true },
    }),
  ]);
  const limitIds = [...limits.map((l) => l.id), ...removals.map((r) => r.entityId)];

  const events = await prisma.auditEvent.findMany({
    where: {
      OR: [
        { entityType: "Study", entityId: studyId },
        { entityType: "Method", entityId: { in: methods.map((m) => m.id) } },
        { entityType: "DetectionLimit", entityId: { in: limitIds } },
        { entityType: "QualityControlSummary", entityId: { in: qcs.map((q) => q.id) } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_EVENTS,
  });

  const actorIds = [...new Set(events.map((e) => e.actorId).filter((id): id is string => !!id))];
  const users = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return events.map((e) => ({
    id: e.id,
    createdAt: e.createdAt,
    actorName: e.actorId ? (names.get(e.actorId) ?? null) : null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    before: e.before,
    after: e.after,
  }));
}
