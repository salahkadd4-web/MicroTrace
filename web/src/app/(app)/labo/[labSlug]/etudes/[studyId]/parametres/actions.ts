"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { QC_KINDS, TECHNIQUES, UNIT_CODES } from "@/server/engine/enums";
import { numbers, pick, text } from "@/server/form-data";
import { runAction } from "@/server/run-action";
import {
  archiveStudy,
  declarePseudonymisation,
  updateStudy,
} from "@/server/studies";
import { studyFieldsFromForm } from "@/server/study-form";
import {
  addMethod,
  addQcSummary,
  prefillLeslieTable3,
  removeDetectionLimit,
  removeQcSummary,
  upsertDetectionLimit,
} from "@/server/study-settings";

/** Rafraîchit l'étude et tous ses onglets (le journal change à chaque écriture). */
function refresh(labSlug: string, studyId: string): void {
  revalidatePath(`/labo/${labSlug}/etudes/${studyId}`, "layout");
}

export async function updateReferenceAction(
  labSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const studyId = text(formData, "studyId");
    await updateStudy(ctx, studyId, studyFieldsFromForm(formData));
    refresh(labSlug, studyId);
  });
}

export async function addMethodAction(
  labSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const studyId = text(formData, "studyId");
    await addMethod(ctx, studyId, {
      name: text(formData, "name"),
      technique: pick(TECHNIQUES, text(formData, "technique"), "Technique inconnue."),
    });
    refresh(labSlug, studyId);
  });
}

export async function upsertLimitAction(
  labSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const studyId = text(formData, "studyId");
    const { values, invalid } = numbers(formData, ["lod", "loq"]);
    if (invalid) return invalid;
    await upsertDetectionLimit(ctx, studyId, {
      methodId: text(formData, "methodId"),
      polymer: text(formData, "polymer"),
      lod: values.lod,
      loq: values.loq,
      unitCode: pick(UNIT_CODES, text(formData, "unitCode"), "Unité inconnue."),
      source: text(formData, "source"),
    });
    refresh(labSlug, studyId);
  });
}

export async function addQcAction(labSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const studyId = text(formData, "studyId");
    const { values, invalid } = numbers(formData, ["n", "mean", "sd"]);
    if (invalid) return invalid;
    await addQcSummary(ctx, studyId, {
      polymer: text(formData, "polymer"),
      kind: pick(QC_KINDS, text(formData, "kind"), "Type de contrôle inconnu."),
      // Effectif vide : le service le refuse (« Effectif invalide. »).
      n: values.n ?? Number.NaN,
      mean: values.mean,
      sd: values.sd,
      unitCode: pick(UNIT_CODES, text(formData, "unitCode"), "Unité inconnue."),
      source: text(formData, "source"),
    });
    refresh(labSlug, studyId);
  });
}

export async function prefillAction(labSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const studyId = text(formData, "studyId");
    await prefillLeslieTable3(ctx, studyId);
    refresh(labSlug, studyId);
  });
}

export async function removeLimitAction(labSlug: string, limitId: string): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const removed = await removeDetectionLimit(ctx, limitId);
    refresh(labSlug, removed.studyId);
  });
}

export async function removeQcAction(labSlug: string, qcId: string): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    const removed = await removeQcSummary(ctx, qcId);
    refresh(labSlug, removed.studyId);
  });
}

export async function declarePseudonymisationAction(labSlug: string, studyId: string): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    await declarePseudonymisation(ctx, studyId);
    refresh(labSlug, studyId);
  });
}

export async function archiveStudyAction(labSlug: string, studyId: string, reason: string): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    await archiveStudy(ctx, studyId, reason);
    refresh(labSlug, studyId);
  });
}
