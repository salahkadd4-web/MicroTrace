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
  upsertDetectionLimit,
} from "@/server/study-settings";

/** Rafraîchit l'étude et tous ses onglets (le journal change à chaque écriture). */
function refresh(studyId: string): void {
  revalidatePath(`/etudes/${studyId}`, "layout");
}

export async function updateReferenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async (user) => {
    const studyId = text(formData, "studyId");
    await updateStudy(user, studyId, studyFieldsFromForm(formData));
    refresh(studyId);
  });
}

export async function addMethodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async (user) => {
    const studyId = text(formData, "studyId");
    await addMethod(user, studyId, {
      name: text(formData, "name"),
      technique: pick(TECHNIQUES, text(formData, "technique"), "Technique inconnue."),
    });
    refresh(studyId);
  });
}

export async function upsertLimitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async (user) => {
    const studyId = text(formData, "studyId");
    const { values, invalid } = numbers(formData, ["lod", "loq"]);
    if (invalid) return invalid;
    await upsertDetectionLimit(user, studyId, {
      methodId: text(formData, "methodId"),
      polymer: text(formData, "polymer"),
      lod: values.lod,
      loq: values.loq,
      unitCode: pick(UNIT_CODES, text(formData, "unitCode"), "Unité inconnue."),
      source: text(formData, "source"),
    });
    refresh(studyId);
  });
}

export async function addQcAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async (user) => {
    const studyId = text(formData, "studyId");
    const { values, invalid } = numbers(formData, ["n", "mean", "sd"]);
    if (invalid) return invalid;
    await addQcSummary(user, studyId, {
      polymer: text(formData, "polymer"),
      kind: pick(QC_KINDS, text(formData, "kind"), "Type de contrôle inconnu."),
      // Effectif vide : le service le refuse (« Effectif invalide. »).
      n: values.n ?? Number.NaN,
      mean: values.mean,
      sd: values.sd,
      unitCode: pick(UNIT_CODES, text(formData, "unitCode"), "Unité inconnue."),
      source: text(formData, "source"),
    });
    refresh(studyId);
  });
}

export async function prefillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async (user) => {
    const studyId = text(formData, "studyId");
    await prefillLeslieTable3(user, studyId);
    refresh(studyId);
  });
}

export async function removeLimitAction(limitId: string): Promise<ActionState> {
  return runAction(async (user) => {
    const removed = await removeDetectionLimit(user, limitId);
    refresh(removed.studyId);
  });
}

export async function declarePseudonymisationAction(studyId: string): Promise<ActionState> {
  return runAction(async (user) => {
    await declarePseudonymisation(user, studyId);
    refresh(studyId);
  });
}

export async function archiveStudyAction(studyId: string, reason: string): Promise<ActionState> {
  return runAction(async (user) => {
    await archiveStudy(user, studyId, reason);
    refresh(studyId);
  });
}
