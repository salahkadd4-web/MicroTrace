import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/server/db";
import type { SessionUser } from "@/server/users";

/** Utilisateur de la session ; `active` est revérifié en base à chaque appel. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/connexion");
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, active: true },
  });
  if (!user || !user.active) redirect("/connexion");
  return { id: user.id, name: user.name, email: user.email };
}

/** Utilisateur de la session s'il y en a une valide ; sinon null (pages publiques). */
export async function getOptionalUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, active: true },
  });
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email };
}
