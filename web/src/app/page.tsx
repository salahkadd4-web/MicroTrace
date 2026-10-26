import { redirect } from "next/navigation";
import { isPlatformAdmin, listMyLaboratories } from "@/server/labs";
import { requireUser } from "@/server/session";

/**
 * Premier laboratoire de l'utilisateur ; sinon la console de la plateforme (page créée à la
 * tâche 12) pour son équipe ; sinon l'avis « aucun laboratoire ».
 */
export default async function Home() {
  const user = await requireUser();
  const labs = await listMyLaboratories(user.id);
  // Premier laboratoire actif ; à défaut le premier (l'utilisateur y voit l'avis de suspension).
  const first = labs.find((l) => !l.suspended) ?? labs[0];
  if (first) redirect(`/labo/${first.slug}/projets`);
  if (await isPlatformAdmin(user.id)) redirect("/admin");
  redirect("/aucun-laboratoire");
}
