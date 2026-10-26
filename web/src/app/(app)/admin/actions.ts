"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { appOrigin } from "@/server/app-url";
import { text } from "@/server/form-data";
import { createFirstAdminInvitation } from "@/server/invitations";
import { createLaboratory } from "@/server/labs";
import { setLaboratorySuspended } from "@/server/platform";
import { runPlatformAction } from "@/server/platform-action";
import { assertEmailShape, normalizeEmail } from "@/server/users";

/** Crée le laboratoire puis l'invitation de son premier responsable ; le lien est affiché une fois. */
export async function createLaboratoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runPlatformAction(async (admin) => {
    const email = normalizeEmail(text(formData, "email"));
    // Adresse vérifiée avant de créer quoi que ce soit.
    assertEmailShape(email);
    const lab = await createLaboratory(admin, { name: text(formData, "name") });
    const { token } = await createFirstAdminInvitation(admin, lab.id, email);
    revalidatePath("/admin");
    return { ok: true, link: `${await appOrigin()}/invitation/${token}` };
  });
}

export async function setSuspendedAction(
  laboratoryId: string,
  suspended: boolean,
): Promise<ActionState> {
  return runPlatformAction(async (admin) => {
    await setLaboratorySuspended(admin, laboratoryId, suspended);
    revalidatePath("/admin");
  });
}
