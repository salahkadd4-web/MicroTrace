import { EmptyState } from "@/components/app/EmptyState";

export default function RapportPage() {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Rapport</h2>
      <EmptyState title="Disponible à l'étape suivante du prototype" />
    </section>
  );
}
