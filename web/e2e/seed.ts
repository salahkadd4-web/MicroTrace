/**
 * Données de départ du bout en bout, créées par les services (jamais par l'interface
 * d'administration) : une équipe plateforme, deux laboratoires avec leur responsable, et pour
 * chacun une étude sans import. Lancé par global-setup avec `tsx --conditions=react-server`.
 */
import { writeFileSync } from "node:fs";
import { prisma } from "@/server/db";
import { acceptInvitation, createLaboratoryWithFirstAdmin } from "@/server/invitations";
import type { LabContext } from "@/server/lab-context";
import { createProject } from "@/server/projects";
import { createStudy } from "@/server/studies";
import { createUser } from "@/server/users";

async function labWithAdmin(
  platform: { id: string; name: string; email: string },
  labName: string,
  email: string,
  password: string,
) {
  const { token, laboratoryId } = await createLaboratoryWithFirstAdmin(platform, {
    name: labName,
    email,
  });
  const { labSlug } = await acceptInvitation(token, { name: `Responsable ${labName}`, password });
  const lab = await prisma.laboratory.findUniqueOrThrow({ where: { id: laboratoryId } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const ctx = {
    userId: user.id,
    userName: user.name,
    laboratoryId: lab.id,
    labSlug,
    labName: lab.name,
    role: "lab_admin",
  } as LabContext;
  const project = await createProject(ctx, { title: `Projet de ${labName}` });
  const study = await createStudy(ctx, project.id, {
    title: `Étude de ${labName}`,
    nature: "laboratory",
    blankCorrected: "unknown",
  });
  return { labSlug, email, studyId: study.id };
}

async function main() {
  const password = process.env.E2E_PASSWORD;
  const stateFile = process.env.E2E_STATE_FILE;
  if (!password || !stateFile) throw new Error("E2E_PASSWORD et E2E_STATE_FILE sont requis.");
  try {
    const platform = await createUser({
      email: "plateforme@e2e.test",
      name: "Équipe plateforme",
      password,
      isPlatformAdmin: true,
    });
    const labA = await labWithAdmin(platform, "Laboratoire Alpha", "alice@e2e.test", password);
    const labB = await labWithAdmin(platform, "Laboratoire Beta", "bob@e2e.test", password);
    writeFileSync(stateFile, JSON.stringify({ labA, labB }), "utf8");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
