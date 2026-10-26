import "server-only";
import { notFound } from "next/navigation";
import type { LabRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { DomainError } from "@/server/errors";
import { assertRole } from "@/server/lab-role";
import { requireUser } from "@/server/session";

export { assertRole };

/** Contexte de laboratoire vérifié (spec §11) : seul `requireLab` en fabrique un pour une requête. */
export type LabContext = {
  userId: string;
  userName: string;
  laboratoryId: string;
  labSlug: string;
  labName: string;
  role: LabRole;
};

/**
 * Contexte du laboratoire `labSlug` pour l'utilisateur de la session. L'appartenance et le statut
 * du laboratoire sont relus en base à chaque appel. Un non-membre et un laboratoire inconnu
 * reçoivent le même 404, pour ne pas révéler l'existence du laboratoire.
 */
export async function requireLab(
  labSlug: string,
  minRole: LabRole = "viewer",
): Promise<LabContext> {
  const user = await requireUser();
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, laboratory: { slug: labSlug } },
    include: { laboratory: true },
  });
  if (!membership) notFound();
  const lab = membership.laboratory;
  if (lab.suspendedAt) throw new DomainError("Laboratoire suspendu.");
  const ctx: LabContext = {
    userId: user.id,
    userName: user.name,
    laboratoryId: lab.id,
    labSlug: lab.slug,
    labName: lab.name,
    role: membership.role,
  };
  assertRole(ctx, minRole);
  return ctx;
}

/**
 * Laboratoire par défaut de l'utilisateur : son premier laboratoire (par date de création).
 * TODO(Tâche 11) : à supprimer quand les pages vivront sous /labo/[labSlug] et recevront le slug.
 */
export async function requireDefaultLab(minRole: LabRole = "viewer"): Promise<LabContext> {
  const user = await requireUser();
  const first = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: [{ laboratory: { createdAt: "asc" } }, { id: "asc" }],
    select: { laboratory: { select: { slug: true } } },
  });
  if (!first) notFound();
  return requireLab(first.laboratory.slug, minRole);
}
