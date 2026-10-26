import "server-only";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import type { SessionUser } from "@/server/users";

const MAX_TITLE = 200;

export function normalizeTitle(raw: string): string {
  const title = raw.trim();
  if (!title) throw new DomainError("Le titre est obligatoire.");
  if (title.length > MAX_TITLE)
    throw new DomainError(`Le titre ne doit pas dépasser ${MAX_TITLE} caractères.`);
  return title;
}

export async function createProject(
  actor: SessionUser,
  input: { title: string; description?: string | null; laboratoryId: string },
) {
  const title = normalizeTitle(input.title);
  // La colonne est non nulle : une description vide est stockée comme "".
  const description = (input.description ?? "").trim();
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: { title, description, ownerId: actor.id, laboratoryId: input.laboratoryId },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "project.create",
      entityType: "Project",
      entityId: project.id,
      after: { title, description },
      laboratoryId: input.laboratoryId,
    });
    return project;
  });
}

export function listProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { studies: true } } },
  });
}

/** Projet avec ses études (la plus récente d'abord), ou null. */
export function getProject(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: { studies: { orderBy: { createdAt: "desc" } } },
  });
}
