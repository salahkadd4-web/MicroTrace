import "server-only";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertRole } from "@/server/lab-role";
import type { LabContext } from "@/server/lab-context";

const MAX_TITLE = 200;

export function normalizeTitle(raw: string): string {
  const title = raw.trim();
  if (!title) throw new DomainError("Le titre est obligatoire.");
  if (title.length > MAX_TITLE)
    throw new DomainError(`Le titre ne doit pas dépasser ${MAX_TITLE} caractères.`);
  return title;
}

export async function createProject(
  ctx: LabContext,
  input: { title: string; description?: string | null },
) {
  assertRole(ctx, "researcher");
  const title = normalizeTitle(input.title);
  // La colonne est non nulle : une description vide est stockée comme "".
  const description = (input.description ?? "").trim();
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: { title, description, ownerId: ctx.userId, laboratoryId: ctx.laboratoryId },
    });
    await recordAudit(tx, {
      actorId: ctx.userId,
      action: "project.create",
      entityType: "Project",
      entityId: project.id,
      after: { title, description },
      laboratoryId: ctx.laboratoryId,
    });
    return project;
  });
}

export function listProjects(ctx: LabContext) {
  return prisma.project.findMany({
    where: { laboratoryId: ctx.laboratoryId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { studies: true } } },
  });
}

/** Projet avec ses études (la plus récente d'abord), ou null. */
export function getProject(ctx: LabContext, projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, laboratoryId: ctx.laboratoryId },
    include: { studies: { orderBy: { createdAt: "desc" } } },
  });
}
