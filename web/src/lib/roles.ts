import type { LabRole } from "@/generated/prisma/enums";

/** Rôles qui voient les formulaires d'écriture (chercheur et responsable) ; le serveur reste juge. */
export function canWrite(role: LabRole): boolean {
  return role === "researcher" || role === "lab_admin";
}
