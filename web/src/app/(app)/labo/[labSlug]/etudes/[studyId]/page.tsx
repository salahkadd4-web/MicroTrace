import { redirect } from "next/navigation";
import { requireLab } from "@/server/lab-context";

/** /etudes/<id> n'a pas de contenu propre : on ouvre l'onglet Paramètres. */
export default async function StudyIndexPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  await requireLab(labSlug);
  redirect(`/labo/${labSlug}/etudes/${studyId}/parametres`);
}
