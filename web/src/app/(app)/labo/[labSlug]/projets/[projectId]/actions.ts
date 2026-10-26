"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { text } from "@/server/form-data";
import { runAction } from "@/server/run-action";
import { createStudy } from "@/server/studies";
import { studyFieldsFromForm } from "@/server/study-form";

export async function createStudyAction(
  labSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const projectId = text(formData, "projectId");
    const study = await createStudy(ctx, projectId, studyFieldsFromForm(formData));
    revalidatePath(`/labo/${labSlug}/projets/${projectId}`);
    redirect(`/labo/${labSlug}/etudes/${study.id}/parametres`);
  });
}
