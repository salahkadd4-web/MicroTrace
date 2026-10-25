"use client";

import { useState } from "react";
import { FormField } from "@/components/app/FormField";
import { SelectField } from "@/components/app/SelectField";
import { Input } from "@/components/ui/input";
import { BLANK_CORRECTED_LABELS, NATURE_LABELS, toOptions } from "@/lib/labels";

const NATURES = toOptions(NATURE_LABELS);
const BLANK_OPTIONS = toOptions(BLANK_CORRECTED_LABELS);

export type StudyFieldValues = {
  title: string;
  nature: string;
  referenceDoi: string;
  referenceLicense: string;
  blankCorrected: string;
};

/** Champs d'une étude (création et référence). DOI et licence seulement pour une étude publiée. */
export function StudyFields({ defaults }: { defaults?: Partial<StudyFieldValues> }) {
  const [nature, setNature] = useState(defaults?.nature ?? "");
  return (
    <>
      <FormField id="study-title" label="Titre">
        <Input id="study-title" name="title" defaultValue={defaults?.title} required />
      </FormField>
      <FormField id="study-nature" label="Nature des données">
        <SelectField
          id="study-nature"
          name="nature"
          options={NATURES}
          value={nature}
          onValueChange={setNature}
        />
      </FormField>
      {nature === "published" ? (
        <>
          <FormField id="study-doi" label="DOI de référence">
            <Input id="study-doi" name="referenceDoi" defaultValue={defaults?.referenceDoi} />
          </FormField>
          <FormField id="study-license" label="Licence de référence">
            <Input
              id="study-license"
              name="referenceLicense"
              defaultValue={defaults?.referenceLicense}
            />
          </FormField>
        </>
      ) : null}
      <FormField id="study-blank" label="Correction du blanc">
        <SelectField
          id="study-blank"
          name="blankCorrected"
          options={BLANK_OPTIONS}
          defaultValue={defaults?.blankCorrected ?? "unknown"}
        />
      </FormField>
    </>
  );
}
