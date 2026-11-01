"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { CORRECTION_OPTIONS } from "@/lib/images";
import { DomainError } from "@/server/errors";
import { text } from "@/server/form-data";
import { recordImageDecision } from "@/server/images";
import { runAction } from "@/server/run-action";

const PREFIX = "particle-";
const INVALID = "Corrections invalides.";

/** Traduit les champs `particle-<id>` en exclusions et changements de forme (aucun calcul). */
function corrections(formData: FormData) {
  const excluded: number[] = [];
  const reshaped: { id: number; shape: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(PREFIX) || typeof value !== "string") continue;
    const idText = key.slice(PREFIX.length);
    const id = Number(idText);
    const option = CORRECTION_OPTIONS.find((o) => o.code === value);
    if (!/^\d+$/.test(idText) || !Number.isSafeInteger(id) || !option) {
      throw new DomainError(INVALID);
    }
    if (option.code === "proposed") continue;
    if (option.code === "excluded") excluded.push(id);
    else reshaped.push({ id, shape: option.code });
  }
  const missedText = text(formData, "missed").trim();
  const missed = missedText === "" ? 0 : /^\d+$/.test(missedText) ? Number(missedText) : Number.NaN;
  return { excluded, reshaped, missed };
}

/** Enregistre la décision d'une personne sur une analyse d'image (chercheur ou plus ; le service revérifie tout). */
export async function recordImageDecisionAction(
  labSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const studyId = text(formData, "studyId");
    const decision = text(formData, "decision");
    // Les corrections ne comptent que pour « Corrigée » : le service refuse les autres cas.
    const fixes =
      decision === "corrected" ? corrections(formData) : { excluded: [], reshaped: [], missed: 0 };
    await recordImageDecision(ctx, studyId, text(formData, "analysisId"), {
      decision,
      ...fixes,
      note: text(formData, "note"),
    });
    revalidatePath(`/labo/${labSlug}/etudes/${studyId}`, "layout");
  });
}
