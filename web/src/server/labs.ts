import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { LabRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { recordAudit, type Tx } from "@/server/audit";
import { DomainError } from "@/server/errors";
import { assertPlatformAdmin } from "@/server/platform";
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

/** Nom de laboratoire nettoyé et vérifié (forme seulement). */
function parseLabName(input: string): string {
  const name = input.trim();
  if (!name) throw new DomainError("Le nom du laboratoire est obligatoire.");
  if (name.length > MAX_NAME)
    throw new DomainError(`Le nom ne doit pas dépasser ${MAX_NAME} caractères.`);
  return name;
}

/** Rejoue `fn` (une transaction complète) quand la contrainte d'unicité du slug départage une course. */
export async function withSlugRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!clash || attempt >= 4) throw e;
    }
  }
}

/** Création du laboratoire et de son audit `lab.create` dans la transaction de l'appelant. */
export async function createLaboratoryIn(tx: Tx, admin: SessionUser, rawName: string) {
  const name = parseLabName(rawName);
  await assertPlatformAdmin(tx, admin);
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
}

/** Crée un laboratoire seul (réservé à l'équipe de la plateforme, relue en base). */
export async function createLaboratory(admin: SessionUser, input: { name: string }) {
  parseLabName(input.name);
  return withSlugRetry(() =>
    prisma.$transaction((tx) => createLaboratoryIn(tx, admin, input.name)),
  );
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

/** Équipe de la plateforme : relu en base (un compte inactif n'en fait plus partie). */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPlatformAdmin: true, active: true },
  });
  return Boolean(user?.active && user.isPlatformAdmin);
}
