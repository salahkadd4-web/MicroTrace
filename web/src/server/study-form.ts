import "server-only";
import { BLANK_CORRECTED_LABELS, NATURE_LABELS } from "@/lib/labels";
import { pick, text } from "@/server/form-data";

const NATURES = Object.keys(NATURE_LABELS) as (keyof typeof NATURE_LABELS)[];
const BLANK = Object.keys(BLANK_CORRECTED_LABELS) as (keyof typeof BLANK_CORRECTED_LABELS)[];

/** Champs d'étude du formulaire (création et référence) ; DOI et licence absents = vides. */
export function studyFieldsFromForm(fd: FormData) {
  return {
    title: text(fd, "title"),
    nature: pick(NATURES, text(fd, "nature"), "Choisissez la nature des données."),
    referenceDoi: text(fd, "referenceDoi"),
    referenceLicense: text(fd, "referenceLicense"),
    blankCorrected: pick(BLANK, text(fd, "blankCorrected"), "Choisissez la correction du blanc."),
  };
}
