import type { LabRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import type { LabContext } from "@/server/lab-context";
import { createUser } from "@/server/users";

/** Laboratoire de test (création directe en base). */
export async function makeLab(name: string, slug = name.toLowerCase().replace(/\W+/g, "-")) {
  return prisma.laboratory.create({ data: { name, slug } });
}

/** Utilisateur membre d'un laboratoire, avec son contexte vérifié (comme le rendrait `requireLab`). */
export async function makeMember(
  lab: { id: string; slug: string; name: string },
  role: LabRole,
  email: string,
  name = email.split("@")[0],
): Promise<LabContext> {
  const user = await createUser({
    email,
    name,
    password: "mot-de-passe-solide-1",
  });
  await prisma.membership.create({ data: { userId: user.id, laboratoryId: lab.id, role } });
  return {
    userId: user.id,
    userName: user.name,
    laboratoryId: lab.id,
    labSlug: lab.slug,
    labName: lab.name,
    role,
  };
}
