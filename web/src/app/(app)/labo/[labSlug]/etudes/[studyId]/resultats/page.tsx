import { requireLab } from "@/server/lab-context";
import { EmptyState } from "@/components/app/EmptyState";

export default async function ResultatsPage({
  params,
}: {
  params: Promise<{ labSlug: string }>;
}) {
  const { labSlug } = await params;
  await requireLab(labSlug);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Résultats</h2>
      <EmptyState title="Disponible à l'étape suivante du prototype" />
    </section>
  );
}
