"use client";

import { useState } from "react";
import { ActionForm } from "@/components/app/ActionForm";
import { FormField } from "@/components/app/FormField";
import { SelectField } from "@/components/app/SelectField";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CORRECTION_OPTIONS, IMAGE_DECISIONS, MAX_MISSED, type ImageDecision } from "@/lib/images";
import { NOTE_MAX_LENGTH } from "@/lib/quality";
import { recordImageDecisionAction } from "./actions";

export type DecisionParticle = { id: number; shapeLabel: string };

/** Dernière décision « Corrigée » : le formulaire repart d'elle, il ne l'annule pas en silence. */
export type PreviousCorrection = {
  excluded: readonly number[];
  reshaped: readonly { id: number; shape: string }[];
  missed: number;
};

function Fields({
  studyId,
  analysisId,
  unreliable,
  particles,
  previous,
}: {
  studyId: string;
  analysisId: string;
  unreliable: boolean;
  particles: readonly DecisionParticle[];
  previous?: PreviousCorrection | null;
}) {
  const initialChoice = (id: number): string => {
    if (previous?.excluded.includes(id)) return "excluded";
    return previous?.reshaped.find((r) => r.id === id)?.shape ?? "proposed";
  };
  const [decision, setDecision] = useState<ImageDecision | null>(null);
  const chosen = IMAGE_DECISIONS.find((d) => d.code === decision);
  const noteRequired = !!chosen?.noteRequired;
  const choices = IMAGE_DECISIONS.filter((d) => !(unreliable && d.code === "accepted"));
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
        <div className="space-y-4">
          {previous ? (
            <p className="text-sm text-muted-foreground">
              Le formulaire reprend votre dernière correction : modifiez-la, elle sera remplacée
              par cette nouvelle décision.
            </p>
          ) : null}
          {particles.length > 0 ? (
            <div className="max-h-96 overflow-auto rounded-lg border">
              <Table>
                <TableCaption className="sr-only">Forme retenue pour chaque particule</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Particule</TableHead>
                    <TableHead>Forme retenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {particles.map((p) => {
                    const id = `${analysisId}-particle-${p.id}`;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="tabular-nums">{p.id}</TableCell>
                        <TableCell className="min-w-48 whitespace-normal">
                          <label htmlFor={id} className="sr-only">
                            Forme retenue pour la particule {p.id}
                          </label>
                          <SelectField
                            id={id}
                            name={`particle-${p.id}`}
                            defaultValue={initialChoice(p.id)}
                            options={CORRECTION_OPTIONS.map((o) => ({
                              value: o.code,
                              label: o.code === "proposed" ? `Proposée : ${p.shapeLabel}` : o.label,
                            }))}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <FormField id={`${analysisId}-missed`} label="Particules manquées (sans contour)">
            <Input
              id={`${analysisId}-missed`}
              name="missed"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_MISSED}
              step={1}
              defaultValue={previous?.missed ?? 0}
              className="max-w-32"
            />
          </FormField>
        </div>
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
            : "Note requise pour « Rejetée »."}
        </p>
      </FormField>
    </>
  );
}

/** Enregistre la décision d'une personne sur une analyse d'image (corrections par particule). */
export function ImageDecisionForm({
  labSlug,
  studyId,
  analysisId,
  unreliable,
  particles,
  previous,
}: {
  labSlug: string;
  studyId: string;
  analysisId: string;
  unreliable: boolean;
  particles: readonly DecisionParticle[];
  previous?: PreviousCorrection | null;
}) {
  return (
    <ActionForm
      action={recordImageDecisionAction.bind(null, labSlug)}
      submitLabel="Enregistrer la décision"
      pendingLabel="Enregistrement…"
    >
      {() => (
        <Fields
          studyId={studyId}
          analysisId={analysisId}
          unreliable={unreliable}
          particles={particles}
          previous={previous}
        />
      )}
    </ActionForm>
  );
}
