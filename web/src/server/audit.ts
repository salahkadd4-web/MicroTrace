import "server-only";
import type { Prisma } from "@/generated/prisma/client";

export type Tx = Prisma.TransactionClient;

export type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
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
    },
  });
}
