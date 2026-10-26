import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { LabRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { assertRole } from "@/server/lab-role";
import { requireUser } from "@/server/session";

export { assertRole };

declare const labContextBrand: unique symbol;

/** Contexte de laboratoire vérifié (spec §11) : seul `requireLab` en fabrique un pour une requête. */
export type LabContext = {
  userId: string;
  userName: string;
  laboratoryId: string;
  labSlug: string;
  labName: string;
  role: LabRole;
} & { readonly [labContextBrand]: true };

/** Laboratoire suspendu : les pages affichent un avis dédié, les actions le message du refus. */
export class LabSuspendedError extends DomainError {
  constructor() {
    super("Laboratoire suspendu.");
  }
}

/**
 * Résolution de l'appartenance, mémorisée pour la durée d'une requête (une seule lecture en base
 * même si le layout et la page la demandent) ; relue à chaque nouvelle requête.
 */
const resolveLab = cache(async (labSlug: string): Promise<LabContext> => {
  const user = await requireUser();
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, laboratory: { slug: labSlug } },
    include: { laboratory: true },
  });
  if (!membership) notFound();
  const lab = membership.laboratory;
  if (lab.suspendedAt) throw new LabSuspendedError();
  return {
    userId: user.id,
    userName: user.name,
    laboratoryId: lab.id,
    labSlug: lab.slug,
    labName: lab.name,
    role: membership.role,
  } as LabContext;
});

/**
 * Contexte du laboratoire `labSlug` pour l'utilisateur de la session. L'appartenance et le statut
 * du laboratoire sont relus en base à chaque requête. Un non-membre et un laboratoire inconnu
 * reçoivent le même 404, pour ne pas révéler l'existence du laboratoire.
 */
export async function requireLab(
  labSlug: string,
  minRole: LabRole = "viewer",
): Promise<LabContext> {
  const ctx = await resolveLab(labSlug);
  assertRole(ctx, minRole);
  return ctx;
}
