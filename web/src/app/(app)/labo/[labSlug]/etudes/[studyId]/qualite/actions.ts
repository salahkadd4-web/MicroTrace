"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { text } from "@/server/form-data";
import { recordQualityDecision } from "@/server/quality";
import { runAction } from "@/server/run-action";

/** Enregistre la décision d'une personne sur un signal (chercheur ou plus ; le service revérifie tout). */
export async function recordQualityDecisionAction(
  labSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const studyId = text(formData, "studyId");
    await recordQualityDecision(ctx, studyId, {
      signalKey: text(formData, "signalKey"),
      decision: text(formData, "decision"),
      note: text(formData, "note"),
    });
    revalidatePath(`/labo/${labSlug}/etudes/${studyId}`, "layout");
  });
}
