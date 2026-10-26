import type { LabRole } from "@/generated/prisma/enums";
import { DomainError } from "@/server/errors";

const RANK: Record<LabRole, number> = { viewer: 0, researcher: 1, lab_admin: 2 };

const ROLE_MESSAGES: Record<LabRole, string> = {
  viewer: "Action réservée aux membres du laboratoire.",
  researcher: "Action réservée aux chercheurs du laboratoire.",
  lab_admin: "Action réservée aux responsables du laboratoire.",
};

/** Refuse si le rôle du contexte est inférieur au rôle minimum (viewer < researcher < lab_admin). */
export function assertRole(ctx: { role: LabRole }, minRole: LabRole): void {
  if (RANK[ctx.role] < RANK[minRole]) throw new DomainError(ROLE_MESSAGES[minRole]);
}
