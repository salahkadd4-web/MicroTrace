"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { appOrigin } from "@/server/app-url";
import { text } from "@/server/form-data";
import { createInvitation } from "@/server/invitations";
import { changeMemberRole, removeMember, revokeInvitation } from "@/server/members";
import { runAction } from "@/server/run-action";

const page = (labSlug: string) => `/labo/${labSlug}/membres`;

/** Crée l'invitation et renvoie le lien complet, affiché une seule fois. */
export async function inviteMemberAction(
  labSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(
    labSlug,
    async (ctx) => {
      const { token } = await createInvitation(ctx, {
        email: text(formData, "email"),
        role: text(formData, "role"),
      });
      revalidatePath(page(labSlug));
      return { ok: true, link: `${await appOrigin()}/invitation/${token}` };
    },
    "lab_admin",
  );
}

export async function changeRoleAction(
  labSlug: string,
  membershipId: string,
  role: string,
): Promise<ActionState> {
  return runAction(
    labSlug,
    async (ctx) => {
      await changeMemberRole(ctx, membershipId, role);
      revalidatePath(page(labSlug));
    },
    "lab_admin",
  );
}

export async function removeMemberAction(
  labSlug: string,
  membershipId: string,
): Promise<ActionState> {
  return runAction(
    labSlug,
    async (ctx) => {
      await removeMember(ctx, membershipId);
      revalidatePath(page(labSlug));
    },
    "lab_admin",
  );
}

export async function revokeInvitationAction(
  labSlug: string,
  invitationId: string,
): Promise<ActionState> {
  return runAction(
    labSlug,
    async (ctx) => {
      await revokeInvitation(ctx, invitationId);
      revalidatePath(page(labSlug));
    },
    "lab_admin",
  );
}
