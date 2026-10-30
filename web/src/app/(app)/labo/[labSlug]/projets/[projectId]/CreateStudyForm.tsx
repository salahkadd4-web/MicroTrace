"use client";

import { ActionForm } from "@/components/app/ActionForm";
import { StudyFields } from "@/components/app/StudyFields";
import { createStudyAction } from "./actions";

export function CreateStudyForm({ labSlug, projectId }: { labSlug: string; projectId: string }) {
  return (
    <ActionForm
      action={createStudyAction.bind(null, labSlug)}
      submitLabel="Créer l'étude"
      pendingLabel="Création…"
      columns={2}
    >
      {() => (
        <>
          <input type="hidden" name="projectId" value={projectId} />
          <StudyFields />
        </>
      )}
    </ActionForm>
  );
}
