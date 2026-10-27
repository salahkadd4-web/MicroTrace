import { redirect } from "next/navigation";
import { requireLab } from "@/server/lab-context";

/** /labo/<slug> n'a pas de contenu propre : on ouvre la liste des projets. */
export default async function LaboIndexPage({
  params,
}: {
  params: Promise<{ labSlug: string }>;
}) {
  const { labSlug } = await params;
  await requireLab(labSlug);
  redirect(`/labo/${labSlug}/projets`);
}
