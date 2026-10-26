import { cache } from "react";
import { notFound } from "next/navigation";
import { requireDefaultLab } from "@/server/lab-context";
import { getStudyView } from "@/server/studies";

/** Étude de la page courante (une seule lecture par requête) ; 404 si elle n'existe pas. */
export const loadStudy = cache(async (studyId: string) => {
  // TODO(Tâche 11) : le laboratoire viendra de l'adresse /labo/[labSlug].
  const ctx = await requireDefaultLab();
  const study = await getStudyView(ctx, studyId);
  if (!study) notFound();
  return study;
});
