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
import { requireLab } from "@/server/lab-context";
import { canWrite } from "@/lib/roles";
import { getProject } from "@/server/projects";
import { CreateStudyForm } from "./CreateStudyForm";

export default async function ProjetPage({ params }: { params: Promise<{ labSlug: string; projectId: string }> }) {
  const { labSlug, projectId } = await params;
  const ctx = await requireLab(labSlug);
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
            description={canWrite(ctx.role) ? "Créez une première étude ci-dessous." : undefined}
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
                    <Link href={`/labo/${labSlug}/etudes/${s.id}/parametres`} className="underline">
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
      {canWrite(ctx.role) ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Nouvelle étude</h2>
          <CreateStudyForm labSlug={labSlug} projectId={project.id} />
        </section>
      ) : null}
    </>
  );
}
