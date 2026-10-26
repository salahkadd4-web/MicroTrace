"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { text } from "@/server/form-data";
import { requireDefaultLab } from "@/server/lab-context";
import { createProject } from "@/server/projects";
import { runAction } from "@/server/run-action";

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async (user) => {
    // TODO(Tâche 11) : le laboratoire viendra de l'adresse /labo/[labSlug].
    const lab = await requireDefaultLab("researcher");
    const project = await createProject(user, {
      title: text(formData, "title"),
      description: text(formData, "description"),
      laboratoryId: lab.laboratoryId,
    });
    revalidatePath("/projets");
    redirect(`/projets/${project.id}`);
  });
}
