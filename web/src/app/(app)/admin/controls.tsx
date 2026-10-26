"use client";

import { ActionForm } from "@/components/app/ActionForm";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { FormField } from "@/components/app/FormField";
import { InvitationLink } from "@/components/app/InvitationLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createLaboratoryAction, setSuspendedAction } from "./actions";

export function CreateLaboratoryForm() {
  return (
    <ActionForm
      action={createLaboratoryAction}
      submitLabel="Créer le laboratoire"
      pendingLabel="Création…"
      className="max-w-xl"
    >
      {(state) => (
        <>
          <FormField id="lab-name" label="Nom du laboratoire">
            <Input id="lab-name" name="name" required />
          </FormField>
          <FormField id="lab-admin-email" label="Adresse e-mail du premier responsable">
            <Input id="lab-admin-email" name="email" type="email" autoComplete="off" required />
          </FormField>
          {state.link ? <InvitationLink link={state.link} /> : null}
        </>
      )}
    </ActionForm>
  );
}

export function SuspendButton({
  laboratoryId,
  name,
  suspended,
}: {
  laboratoryId: string;
  name: string;
  suspended: boolean;
}) {
  return (
    <ConfirmDialog
      title={suspended ? "Réactiver ce laboratoire ?" : "Suspendre ce laboratoire ?"}
      description={
        suspended
          ? `Les membres de ${name} retrouveront l'accès à leurs données.`
          : `Les membres de ${name} verront « Laboratoire suspendu. » et ne pourront plus accéder à leurs données.`
      }
      confirmLabel={suspended ? "Réactiver" : "Suspendre"}
      onConfirm={async () => (await setSuspendedAction(laboratoryId, !suspended)).error}
      trigger={
        <Button variant="outline" size="sm">
          {suspended ? "Réactiver" : "Suspendre"}
        </Button>
      }
    />
  );
}
