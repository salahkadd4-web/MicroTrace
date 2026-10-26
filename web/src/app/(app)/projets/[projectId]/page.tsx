import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NATURE_LABELS, labelOf } from "@/lib/labels";
import { requireDefaultLab } from "@/server/lab-context";
import { getProject } from "@/server/projects";
import { CreateStudyForm } from "./CreateStudyForm";

export default async function ProjetPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  // TODO(Tâche 11) : le laboratoire viendra de l'adresse /labo/[labSlug].
  const ctx = await requireDefaultLab();
  const project = await getProject(ctx, projectId);
  if (!project) notFound();
  return (
    <>
      <PageHeader title={project.title} subtitle={project.description || undefined} />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Études</h2>
        {project.studies.length === 0 ? (
          <EmptyState
            title="Aucune étude dans ce projet."
            description="Créez une première étude ci-dessous."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titre</TableHead>
                <TableHead>Nature</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Créée le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {project.studies.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/etudes/${s.id}/parametres`} className="underline">
                      {s.title}
                    </Link>
                  </TableCell>
                  <TableCell>{labelOf(NATURE_LABELS, s.nature)}</TableCell>
                  <TableCell>
                    {s.archivedAt ? <Badge variant="secondary">Archivée</Badge> : "Active"}
                  </TableCell>
                  <TableCell>
                    <DateTimeFr value={s.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Nouvelle étude</h2>
        <CreateStudyForm projectId={project.id} />
      </section>
    </>
  );
}
