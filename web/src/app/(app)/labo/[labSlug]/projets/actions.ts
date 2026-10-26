"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { text } from "@/server/form-data";
import { createProject } from "@/server/projects";
import { runAction } from "@/server/run-action";

export async function createProjectAction(
  labSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const project = await createProject(ctx, {
      title: text(formData, "title"),
      description: text(formData, "description"),
    });
    revalidatePath(`/labo/${labSlug}/projets`);
    redirect(`/labo/${labSlug}/projets/${project.id}`);
  });
}
