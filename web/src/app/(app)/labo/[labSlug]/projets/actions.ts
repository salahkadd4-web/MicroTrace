"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { text } from "@/server/form-data";
import { DomainError } from "@/server/errors";
import { createExampleStudy, type ExampleKind } from "@/server/examples";
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

export async function createExampleStudyAction(
  labSlug: string,
  _prev: ActionState,
  kind: ExampleKind,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    if (kind !== "fictif" && kind !== "leslie2022") {
      throw new DomainError("Exemple inconnu.");
    }
    let studyId: string;
    try {
      ({ studyId } = await createExampleStudy(ctx, kind));
    } finally {
      // Aussi en cas d'échec partiel : le projet créé doit apparaître dans la liste.
      revalidatePath(`/labo/${labSlug}/projets`);
    }
    redirect(`/labo/${labSlug}/etudes/${studyId}/imports`);
  });
}
