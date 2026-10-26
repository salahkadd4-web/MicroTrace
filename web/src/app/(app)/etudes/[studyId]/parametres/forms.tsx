"use client";

import { useState } from "react";
import { ActionForm } from "@/components/app/ActionForm";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { FormField } from "@/components/app/FormField";
import { SelectField } from "@/components/app/SelectField";
import { StudyFields, type StudyFieldValues } from "@/components/app/StudyFields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/action-state";
import { QC_KIND_LABELS, TECHNIQUE_LABELS, toOptions } from "@/lib/labels";
import { unitLabel } from "@/lib/units";
import { UNIT_CODES } from "@/server/engine/enums";
import {
  addMethodAction,
  addQcAction,
  archiveStudyAction,
  declarePseudonymisationAction,
  prefillAction,
  removeLimitAction,
  updateReferenceAction,
  upsertLimitAction,
} from "./actions";

const TECHNIQUE_OPTIONS = toOptions(TECHNIQUE_LABELS);
const QC_KIND_OPTIONS = toOptions(QC_KIND_LABELS);
const UNIT_OPTIONS = UNIT_CODES.map((code) => ({ value: code, label: unitLabel(code) }));

const DECIMAL = { type: "text", inputMode: "decimal", autoComplete: "off" } as const;

function StudyId({ studyId }: { studyId: string }) {
  return <input type="hidden" name="studyId" value={studyId} />;
}

export function ReferenceForm({
  studyId,
  defaults,
}: {
  studyId: string;
  defaults: StudyFieldValues;
}) {
  return (
    <ActionForm
      action={updateReferenceAction}
      submitLabel="Enregistrer"
      pendingLabel="Enregistrement…"
      className="max-w-xl"
      resetOnSuccess={false}
    >
      {() => (
        <>
          <StudyId studyId={studyId} />
          <StudyFields defaults={defaults} />
        </>
      )}
    </ActionForm>
  );
}

export function AddMethodForm({ studyId }: { studyId: string }) {
  return (
    <ActionForm
      action={addMethodAction}
      submitLabel="Ajouter la méthode"
      pendingLabel="Ajout…"
      className="max-w-xl"
    >
      {() => (
        <>
          <StudyId studyId={studyId} />
          <FormField id="method-name" label="Nom de la méthode">
            <Input id="method-name" name="name" required />
          </FormField>
          <FormField id="method-technique" label="Technique">
            <SelectField id="method-technique" name="technique" options={TECHNIQUE_OPTIONS} />
          </FormField>
        </>
      )}
    </ActionForm>
  );
}

export function AddLimitForm({
  studyId,
  methods,
}: {
  studyId: string;
  methods: { id: string; name: string }[];
}) {
  const methodOptions = methods.map((m) => ({ value: m.id, label: m.name }));
  return (
    <ActionForm
      action={upsertLimitAction}
      submitLabel="Enregistrer la limite"
      pendingLabel="Enregistrement…"
      className="max-w-xl"
    >
      {(state) => (
        <>
          <StudyId studyId={studyId} />
          <FormField id="limit-method" label="Méthode">
            <SelectField id="limit-method" name="methodId" options={methodOptions} />
          </FormField>
          <FormField id="limit-polymer" label="Polymère">
            <Input id="limit-polymer" name="polymer" required />
          </FormField>
          <FormField id="limit-lod" label="LOD" error={state.fieldErrors?.lod}>
            <Input id="limit-lod" name="lod" {...DECIMAL} aria-invalid={!!state.fieldErrors?.lod} />
          </FormField>
          <FormField id="limit-loq" label="LOQ" error={state.fieldErrors?.loq}>
            <Input id="limit-loq" name="loq" {...DECIMAL} aria-invalid={!!state.fieldErrors?.loq} />
          </FormField>
          <FormField id="limit-unit" label="Unité">
            <SelectField id="limit-unit" name="unitCode" options={UNIT_OPTIONS} />
          </FormField>
          <FormField id="limit-source" label="Source">
            <Input id="limit-source" name="source" required />
          </FormField>
        </>
      )}
    </ActionForm>
  );
}

export function AddQcForm({ studyId }: { studyId: string }) {
  return (
    <ActionForm
      action={addQcAction}
      submitLabel="Ajouter le contrôle"
      pendingLabel="Ajout…"
      className="max-w-xl"
    >
      {(state) => (
        <>
          <StudyId studyId={studyId} />
          <FormField id="qc-polymer" label="Polymère">
            <Input id="qc-polymer" name="polymer" required />
          </FormField>
          <FormField id="qc-kind" label="Type de contrôle">
            <SelectField id="qc-kind" name="kind" options={QC_KIND_OPTIONS} />
          </FormField>
          <FormField id="qc-n" label="Effectif (n)" error={state.fieldErrors?.n}>
            <Input id="qc-n" name="n" {...DECIMAL} required aria-invalid={!!state.fieldErrors?.n} />
          </FormField>
          <FormField id="qc-mean" label="Moyenne" error={state.fieldErrors?.mean}>
            <Input id="qc-mean" name="mean" {...DECIMAL} aria-invalid={!!state.fieldErrors?.mean} />
          </FormField>
          <FormField id="qc-sd" label="Écart type" error={state.fieldErrors?.sd}>
            <Input id="qc-sd" name="sd" {...DECIMAL} aria-invalid={!!state.fieldErrors?.sd} />
          </FormField>
          <FormField id="qc-unit" label="Unité">
            <SelectField id="qc-unit" name="unitCode" options={UNIT_OPTIONS} />
          </FormField>
          <FormField id="qc-source" label="Source">
            <Input id="qc-source" name="source" required />
          </FormField>
        </>
      )}
    </ActionForm>
  );
}

export function PrefillForm({ studyId }: { studyId: string }) {
  return (
    <ActionForm
      action={prefillAction}
      submitLabel="Préremplir avec Leslie et al. 2022 (Tableau 3)"
      pendingLabel="Préremplissage…"
      submitVariant="outline"
    >
      {() => <StudyId studyId={studyId} />}
    </ActionForm>
  );
}

/** Bouton qui demande confirmation puis appelle une action ; une erreur garde le dialogue ouvert. */
function ConfirmActionButton({
  label,
  title,
  description,
  confirmLabel,
  requireReason,
  variant,
  disabled,
  run,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  requireReason?: boolean;
  variant?: "default" | "outline" | "destructive";
  disabled?: boolean;
  run: (reason?: string) => Promise<ActionState>;
}) {
  return (
    <ConfirmDialog
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      requireReason={requireReason}
      onConfirm={async (reason) => (await run(reason)).error}
      trigger={
        <Button type="button" variant={variant} disabled={disabled}>
          {label}
        </Button>
      }
    />
  );
}

export function RemoveLimitButton({ limitId }: { limitId: string }) {
  return (
    <ConfirmActionButton
      label="Supprimer"
      title="Supprimer la limite"
      description="Cette limite de détection sera supprimée. L'opération est enregistrée au journal."
      confirmLabel="Supprimer"
      variant="destructive"
      run={() => removeLimitAction(limitId)}
    />
  );
}

export function PseudonymisationControl({ studyId }: { studyId: string }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id="pseudonym-declared"
          checked={checked}
          onCheckedChange={(v) => setChecked(v === true)}
        />
        <Label htmlFor="pseudonym-declared">
          Je déclare que les données de cette étude sont pseudonymisées.
        </Label>
      </div>
      <ConfirmActionButton
        label="Déclarer la pseudonymisation"
        title="Déclarer la pseudonymisation"
        description="La déclaration est datée, signée de votre nom et ne pourra plus être modifiée."
        confirmLabel="Déclarer"
        disabled={!checked}
        run={() => declarePseudonymisationAction(studyId)}
      />
    </div>
  );
}

export function ArchiveControl({ studyId }: { studyId: string }) {
  return (
    <ConfirmActionButton
      label="Archiver l'étude"
      title="Archiver l'étude"
      description="L'étude passera en lecture seule. Indiquez le motif de l'archivage."
      confirmLabel="Archiver"
      requireReason
      variant="destructive"
      run={(reason) => archiveStudyAction(studyId, reason ?? "")}
    />
  );
}
