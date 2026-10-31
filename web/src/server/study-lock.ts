import "server-only";
import type { Tx } from "@/server/audit";
import { DomainError } from "@/server/errors";
import type { LabContext } from "@/server/lab-context";
import { assertWritable } from "@/server/studies";

/**
 * Verrouille l'étude du laboratoire (`FOR UPDATE`) puis relit `archivedAt` sous le verrou : un
 * archivage validé pendant l'attente du verrou est vu, et rien n'est écrit sur une étude archivée.
 */
export async function lockWritableStudy(tx: Tx, ctx: LabContext, studyId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
    SELECT "archivedAt" FROM "Study"
    WHERE id = ${studyId} AND "laboratoryId" = ${ctx.laboratoryId} FOR UPDATE`;
  if (rows.length === 0) throw new DomainError("Étude introuvable.");
  assertWritable(rows[0]);
}
