"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { actionError } from "@/server/action-error";
import { text } from "@/server/form-data";
import { acceptInvitation } from "@/server/invitations";
import { getOptionalUser } from "@/server/session";

/**
 * Accepte l'invitation. Connecté : rattache l'utilisateur (l'adresse doit correspondre). Sinon crée
 * le compte puis renvoie vers la connexion. Le jeton n'est ni journalisé ni renvoyé dans une erreur.
 */
export async function acceptInvitationAction(
  token: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const viewer = await getOptionalUser();
    if (viewer) {
      const { labSlug } = await acceptInvitation(token, { user: viewer });
      redirect(`/labo/${labSlug}/projets`);
    }
    const { labSlug } = await acceptInvitation(token, {
      name: text(formData, "name"),
      password: text(formData, "password"),
    });
    // Indicateur seul dans l'URL : jamais l'adresse e-mail.
    redirect(`/connexion?callbackUrl=/labo/${labSlug}/projets&compte=cree`);
  } catch (e) {
    return actionError(e);
  }
}
