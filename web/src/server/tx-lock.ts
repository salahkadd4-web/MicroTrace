import "server-only";
import type { Tx } from "@/server/audit";

/**
 * Verrou de ligne sur le laboratoire jusqu'à la fin de la transaction : sérialise les opérations
 * dont l'invariant porte sur l'ensemble du laboratoire (dernier responsable, invitation unique
 * par adresse).
 */
export async function lockLaboratory(tx: Tx, laboratoryId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Laboratory" WHERE id = ${laboratoryId} FOR UPDATE`;
}
