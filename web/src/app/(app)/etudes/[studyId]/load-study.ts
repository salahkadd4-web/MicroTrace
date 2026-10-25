import { cache } from "react";
import { notFound } from "next/navigation";
import { getStudyView } from "@/server/studies";

/** Étude de la page courante (une seule lecture par requête) ; 404 si elle n'existe pas. */
export const loadStudy = cache(async (studyId: string) => {
  const study = await getStudyView(studyId);
  if (!study) notFound();
  return study;
});
