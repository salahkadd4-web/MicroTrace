"use client";

import { ActionForm } from "@/components/app/ActionForm";
import { StudyFields } from "@/components/app/StudyFields";
import { createStudyAction } from "./actions";

export function CreateStudyForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm
      action={createStudyAction}
      submitLabel="Créer l'étude"
      pendingLabel="Création…"
      className="max-w-xl"
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
