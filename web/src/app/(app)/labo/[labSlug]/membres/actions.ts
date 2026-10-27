"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { appOrigin } from "@/server/app-url";
import { prisma } from "@/server/db";
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

/** Le membre visé est-il l'utilisateur qui agit ? (recherche limitée au laboratoire du contexte) */
async function isSelf(ctx: { userId: string; laboratoryId: string }, membershipId: string) {
  const m = await prisma.membership.findFirst({
    where: { id: membershipId, laboratoryId: ctx.laboratoryId },
    select: { userId: true },
  });
  return m?.userId === ctx.userId;
}

export async function changeRoleAction(
  labSlug: string,
  membershipId: string,
  role: string,
): Promise<ActionState> {
  let self = false;
  const result = await runAction(
    labSlug,
    async (ctx) => {
      self = await isSelf(ctx, membershipId);
      await changeMemberRole(ctx, membershipId, role);
      revalidatePath(page(labSlug));
    },
    "lab_admin",
  );
  // Rétrogradé par lui-même : la page Membres ne lui est plus accessible.
  if (self && !result.error) redirect(`/labo/${labSlug}/projets`);
  return result;
}

export async function removeMemberAction(
  labSlug: string,
  membershipId: string,
): Promise<ActionState> {
  let self = false;
  const result = await runAction(
    labSlug,
    async (ctx) => {
      self = await isSelf(ctx, membershipId);
      await removeMember(ctx, membershipId);
      revalidatePath(page(labSlug));
    },
    "lab_admin",
  );
  // Retiré par lui-même : plus aucun accès à ce laboratoire.
  if (self && !result.error) redirect("/");
  return result;
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
