import { cache } from "react";
import { notFound } from "next/navigation";
import { requireLab } from "@/server/lab-context";
import { getStudyView } from "@/server/studies";

/** Étude de la page courante (une seule lecture par requête) ; 404 si elle n'existe pas. */
export const loadStudy = cache(async (labSlug: string, studyId: string) => {
  const ctx = await requireLab(labSlug);
  const study = await getStudyView(ctx, studyId);
  if (!study) notFound();
  return study;
});
