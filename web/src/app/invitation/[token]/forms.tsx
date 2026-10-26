"use client";

import { ActionForm } from "@/components/app/ActionForm";
import { FormField } from "@/components/app/FormField";
import { Input } from "@/components/ui/input";
import { acceptInvitationAction } from "./actions";

export function SignupInvitationForm({ token, email }: { token: string; email: string }) {
  return (
    <ActionForm
      action={acceptInvitationAction.bind(null, token)}
      submitLabel="Créer mon compte"
      pendingLabel="Création…"
      resetOnSuccess={false}
    >
      {() => (
        <>
          <FormField id="invitation-email" label="Adresse e-mail">
            <Input id="invitation-email" value={email} readOnly />
          </FormField>
          <FormField id="invitation-name" label="Nom">
            <Input id="invitation-name" name="name" autoComplete="name" required />
          </FormField>
          <FormField id="invitation-password" label="Mot de passe (12 caractères au moins)">
            <Input
              id="invitation-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </FormField>
        </>
      )}
    </ActionForm>
  );
}

export function JoinInvitationForm({ token }: { token: string }) {
  return (
    <ActionForm
      action={acceptInvitationAction.bind(null, token)}
      submitLabel="Rejoindre le laboratoire"
      pendingLabel="Un instant…"
      resetOnSuccess={false}
    >
      {() => null}
    </ActionForm>
  );
}
