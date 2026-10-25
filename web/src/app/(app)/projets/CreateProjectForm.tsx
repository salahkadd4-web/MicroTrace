"use client";

import { ActionForm } from "@/components/app/ActionForm";
import { FormField } from "@/components/app/FormField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createProjectAction } from "./actions";

export function CreateProjectForm() {
  return (
    <ActionForm
      action={createProjectAction}
      submitLabel="Créer le projet"
      pendingLabel="Création…"
      className="max-w-xl"
    >
      {() => (
        <>
          <FormField id="project-title" label="Titre">
            <Input id="project-title" name="title" required />
          </FormField>
          <FormField id="project-description" label="Description">
            <Textarea id="project-description" name="description" />
          </FormField>
        </>
      )}
    </ActionForm>
  );
}
