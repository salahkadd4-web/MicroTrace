"use client";

import { useState } from "react";
import { ActionForm } from "@/components/app/ActionForm";
import { FormField } from "@/components/app/FormField";
import { SelectField } from "@/components/app/SelectField";
import { Textarea } from "@/components/ui/textarea";
import { NOTE_MAX_LENGTH } from "@/lib/quality";
import { NOTE_REQUIRED_POLYMERS, SPECTRAL_DECISIONS, type SpectralDecision } from "@/lib/spectral";
import { recordSpectralDecisionAction } from "./actions";

type Vocabulary = readonly { code: string; label: string }[];

function Fields({
  studyId,
  analysisId,
  notIdentified,
  vocabulary,
}: {
  studyId: string;
  analysisId: string;
  notIdentified: boolean;
  vocabulary: Vocabulary;
}) {
  const [decision, setDecision] = useState<SpectralDecision | null>(null);
  const [polymer, setPolymer] = useState("");
  const chosen = SPECTRAL_DECISIONS.find((d) => d.code === decision);
  const noteRequired =
    !!chosen &&
    (chosen.noteRequired || (decision === "corrected" && NOTE_REQUIRED_POLYMERS.includes(polymer)));
  const choices = SPECTRAL_DECISIONS.filter((d) => !(notIdentified && d.code === "accepted"));
  return (
    <>
      <input type="hidden" name="studyId" value={studyId} />
      <input type="hidden" name="analysisId" value={analysisId} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Décision</legend>
        {choices.map((d) => (
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
      {decision === "corrected" ? (
        <FormField id={`${analysisId}-polymer`} label="Polymère retenu">
          <SelectField
            id={`${analysisId}-polymer`}
            name="polymer"
            value={polymer}
            onValueChange={setPolymer}
            options={vocabulary.map((p) => ({ value: p.code, label: p.label }))}
          />
        </FormField>
      ) : null}
      <FormField id={`${analysisId}-note`} label="Note">
        <Textarea
          id={`${analysisId}-note`}
          name="note"
          maxLength={NOTE_MAX_LENGTH}
          required={noteRequired}
          aria-describedby={`${analysisId}-note-hint`}
        />
        <p id={`${analysisId}-note-hint`} className="text-xs text-muted-foreground">
          {chosen
            ? noteRequired
              ? "Note requise pour cette décision."
              : "Note facultative pour cette décision."
            : "Note requise pour « Rejetée », et pour « Corrigée » vers « Autre polymère » ou « Non plastique »."}
        </p>
      </FormField>
    </>
  );
}

/** Enregistre la décision d'une personne sur une analyse spectrale. */
export function DecisionForm({
  labSlug,
  studyId,
  analysisId,
  notIdentified,
  vocabulary,
}: {
  labSlug: string;
  studyId: string;
  analysisId: string;
  notIdentified: boolean;
  vocabulary: Vocabulary;
}) {
  return (
    <ActionForm
      action={recordSpectralDecisionAction.bind(null, labSlug)}
      submitLabel="Enregistrer la décision"
      pendingLabel="Enregistrement…"
    >
      {() => (
        <Fields
          studyId={studyId}
          analysisId={analysisId}
          notIdentified={notIdentified}
          vocabulary={vocabulary}
        />
      )}
    </ActionForm>
  );
}
