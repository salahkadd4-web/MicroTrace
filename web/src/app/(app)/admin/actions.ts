"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { appOrigin } from "@/server/app-url";
import { text } from "@/server/form-data";
import {
  createFirstAdminInvitation,
  createLaboratoryWithFirstAdmin,
} from "@/server/invitations";
import { setLaboratorySuspended } from "@/server/platform";
import { runPlatformAction } from "@/server/platform-action";

/** Crée le laboratoire puis l'invitation de son premier responsable ; le lien est affiché une fois. */
export async function createLaboratoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runPlatformAction(async (admin) => {
    const { token } = await createLaboratoryWithFirstAdmin(admin, {
      name: text(formData, "name"),
      email: text(formData, "email"),
    });
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

/** Nouvelle invitation du responsable : refusée côté serveur si le laboratoire a déjà un responsable. */
export async function reinviteFirstAdminAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runPlatformAction(async (admin) => {
    const { token } = await createFirstAdminInvitation(
      admin,
      text(formData, "laboratoryId"),
      text(formData, "email"),
    );
    revalidatePath("/admin");
    return { ok: true, link: `${await appOrigin()}/invitation/${token}` };
  });
}
