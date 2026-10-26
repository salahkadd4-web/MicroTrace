import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { LabRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { DomainError } from "@/server/errors";
import type { SessionUser } from "@/server/users";

const MAX_NAME = 120;
const MAX_SLUG = 48;

/** Adresse d'un laboratoire : minuscules ASCII, tirets, 48 caractères au plus ; "labo" si vide. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, "");
  return slug || "labo";
}

/** Premier slug libre : `base`, puis `base-2`, `base-3`… (la longueur totale reste ≤ 48). */
async function freeSlug(name: string, db: Pick<typeof prisma, "laboratory">): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (
      await db.laboratory.findMany({
        where: { slug: { startsWith: base.slice(0, MAX_SLUG - 6) } },
        select: { slug: true },
      })
    ).map((l) => l.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/g, "") + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Crée un laboratoire (réservé à l'équipe de la plateforme, relue en base). L'invitation du
 * premier responsable est créée à la tâche 12 : seul le nom est demandé pour l'instant.
 */
export async function createLaboratory(admin: SessionUser, input: { name: string }) {
  const name = input.name.trim();
  if (!name) throw new DomainError("Le nom du laboratoire est obligatoire.");
  if (name.length > MAX_NAME)
    throw new DomainError(`Le nom ne doit pas dépasser ${MAX_NAME} caractères.`);
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const actor = await tx.user.findUnique({
          where: { id: admin.id },
          select: { isPlatformAdmin: true, active: true },
        });
        if (!actor?.active || !actor.isPlatformAdmin)
          throw new DomainError("Action réservée à l'équipe de la plateforme.");
        const slug = await freeSlug(name, tx);
        const lab = await tx.laboratory.create({ data: { name, slug } });
        await recordAudit(tx, {
          actorId: admin.id,
          action: "lab.create",
          entityType: "Laboratory",
          entityId: lab.id,
          after: { name, slug },
          laboratoryId: lab.id,
        });
        return lab;
      });
    } catch (e) {
      // Course sur le slug : la contrainte d'unicité tranche, on recalcule.
      const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!clash || attempt >= 4) throw e;
    }
  }
}

export type MyLaboratory = {
  id: string;
  slug: string;
  name: string;
  role: LabRole;
  suspended: boolean;
};

/** Laboratoires de l'utilisateur, du plus ancien au plus récent. */
export async function listMyLaboratories(userId: string): Promise<MyLaboratory[]> {
  const rows = await prisma.membership.findMany({
    where: { userId },
    include: { laboratory: true },
    orderBy: [{ laboratory: { createdAt: "asc" } }, { id: "asc" }],
  });
  return rows.map((m) => ({
    id: m.laboratory.id,
    slug: m.laboratory.slug,
    name: m.laboratory.name,
    role: m.role,
    suspended: m.laboratory.suspendedAt !== null,
  }));
}
