"use client";

import { useState } from "react";
import { ActionForm } from "@/components/app/ActionForm";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NOTE_MAX_LENGTH, QUALITY_DECISIONS, type QualityDecision } from "@/lib/quality";
import { recordQualityDecisionAction } from "./actions";
import { EntryErrorNotice } from "./EntryErrorNotice";

function Fields({
  labSlug,
  studyId,
  signalKey,
  uid,
}: {
  labSlug: string;
  studyId: string;
  signalKey: string;
  uid: string;
}) {
  const [decision, setDecision] = useState<QualityDecision | null>(null);
  const chosen = QUALITY_DECISIONS.find((d) => d.code === decision);
  const noteId = `${uid}-note`;
  return (
    <>
      <input type="hidden" name="studyId" value={studyId} />
      <input type="hidden" name="signalKey" value={signalKey} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Décision</legend>
        {QUALITY_DECISIONS.map((d) => (
          <label key={d.code} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="decision"
              value={d.code}
              required
              checked={decision === d.code}
              onChange={() => setDecision(d.code)}
              className="size-4 accent-primary"
            />
            {d.label}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor={noteId}>Note</Label>
        <Textarea
          id={noteId}
          name="note"
          maxLength={NOTE_MAX_LENGTH}
          required={chosen?.noteRequired ?? false}
          aria-describedby={`${noteId}-hint`}
        />
        <p id={`${noteId}-hint`} className="text-xs text-muted-foreground">
          {chosen
            ? chosen.noteRequired
              ? "Note requise pour cette décision."
              : "Note facultative pour cette décision."
            : "Note requise pour « Examiné — justifié » et « Erreur de saisie confirmée »."}
        </p>
      </div>
      {decision === "entry_error" ? (
        <EntryErrorNotice importsHref={`/labo/${labSlug}/etudes/${studyId}/imports`} />
      ) : null}
    </>
  );
}

/** Enregistre une décision sur un signal : trois choix, note requise selon le choix. */
export function DecisionForm({
  labSlug,
  studyId,
  signalKey,
}: {
  labSlug: string;
  studyId: string;
  signalKey: string;
}) {
  return (
    <ActionForm
      action={recordQualityDecisionAction.bind(null, labSlug)}
      submitLabel="Enregistrer la décision"
      pendingLabel="Enregistrement…"
    >
      {() => <Fields labSlug={labSlug} studyId={studyId} signalKey={signalKey} uid={signalKey.slice(0, 12)} />}
    </ActionForm>
  );
}
