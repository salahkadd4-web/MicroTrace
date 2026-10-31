"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { text } from "@/server/form-data";
import { runAction } from "@/server/run-action";
import { recordSpectralDecision } from "@/server/spectral";

/** Enregistre la décision d'une personne sur une analyse (chercheur ou plus ; le service revérifie tout). */
export async function recordSpectralDecisionAction(
  labSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const studyId = text(formData, "studyId");
    await recordSpectralDecision(ctx, studyId, text(formData, "analysisId"), {
      decision: text(formData, "decision"),
      polymer: text(formData, "polymer"),
      note: text(formData, "note"),
    });
    revalidatePath(`/labo/${labSlug}/etudes/${studyId}`, "layout");
  });
}
