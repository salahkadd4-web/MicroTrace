"use client";

import { useState, useTransition } from "react";
import { ActionForm } from "@/components/app/ActionForm";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { FormError } from "@/components/app/FormError";
import { FormField } from "@/components/app/FormField";
import { InvitationLink } from "@/components/app/InvitationLink";
import { SelectField } from "@/components/app/SelectField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS, toOptions } from "@/lib/labels";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
} from "./actions";

const ROLE_OPTIONS = toOptions(ROLE_LABELS);

export function InviteForm({ labSlug }: { labSlug: string }) {
  return (
    <ActionForm
      action={inviteMemberAction.bind(null, labSlug)}
      submitLabel="Créer l'invitation"
      pendingLabel="Création…"
      className="max-w-xl"
    >
      {(state) => (
        <>
          <FormField id="invite-email" label="Adresse e-mail" error={state.fieldErrors?.email}>
            <Input id="invite-email" name="email" type="email" autoComplete="off" required />
          </FormField>
          <FormField id="invite-role" label="Rôle">
            <SelectField
              id="invite-role"
              name="role"
              options={ROLE_OPTIONS}
              defaultValue="researcher"
            />
          </FormField>
          {state.link ? <InvitationLink link={state.link} /> : null}
        </>
      )}
    </ActionForm>
  );
}

export function RoleControl({
  labSlug,
  membershipId,
  role,
  memberName,
}: {
  labSlug: string;
  membershipId: string;
  role: string;
  memberName: string;
}) {
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const id = `role-${membershipId}`;

  const [confirming, setConfirming] = useState<string | null>(null);

  function apply(next: string) {
    startTransition(async () => {
      const result = await changeRoleAction(labSlug, membershipId, next);
      setError(result.error);
    });
  }

  function change(next: string) {
    if (next === role) return;
    // Rétrograder un responsable (soi-même compris) demande une confirmation.
    if (role === "lab_admin") setConfirming(next);
    else apply(next);
  }

  return (
    <div className="space-y-1" aria-busy={pending}>
      <Label htmlFor={id} className="sr-only">
        Rôle de {memberName}
      </Label>
      <SelectField
        id={id}
        name={id}
        options={ROLE_OPTIONS}
        value={role}
        onValueChange={change}
        required={false}
      />
      <FormError message={error} />
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null);
        }}
        title="Retirer le rôle de responsable ?"
        description={`${memberName} ne pourra plus gérer les membres du laboratoire.`}
        confirmLabel="Rétrograder"
        onConfirm={async () => {
          const next = confirming;
          if (!next) return;
          const result = await changeRoleAction(labSlug, membershipId, next);
          setError(undefined);
          return result.error;
        }}
      />
    </div>
  );
}

export function RemoveMemberButton({
  labSlug,
  membershipId,
  memberName,
}: {
  labSlug: string;
  membershipId: string;
  memberName: string;
}) {
  return (
    <ConfirmDialog
      title="Retirer ce membre ?"
      description={`${memberName} n'aura plus accès au laboratoire. Ses données restent dans le laboratoire.`}
      confirmLabel="Retirer"
      onConfirm={async () => (await removeMemberAction(labSlug, membershipId)).error}
      trigger={
        <Button variant="outline" size="sm">
          Retirer
        </Button>
      }
    />
  );
}

export function RevokeInvitationButton({
  labSlug,
  invitationId,
  email,
}: {
  labSlug: string;
  invitationId: string;
  email: string;
}) {
  return (
    <ConfirmDialog
      title="Révoquer cette invitation ?"
      description={`Le lien envoyé à ${email} ne fonctionnera plus.`}
      confirmLabel="Révoquer"
      onConfirm={async () => (await revokeInvitationAction(labSlug, invitationId)).error}
      trigger={
        <Button variant="outline" size="sm">
          Révoquer
        </Button>
      }
    />
  );
}
