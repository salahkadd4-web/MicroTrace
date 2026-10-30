import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeader } from "@/components/app/PageHeader";
import { Section } from "@/components/app/Section";
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
      <Section title="Études">
        {project.studies.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
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
                    <Link href={`/labo/${labSlug}/etudes/${s.id}/parametres`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {s.title}
                    </Link>
                  </TableCell>
                  <TableCell>{labelOf(NATURE_LABELS, s.nature)}</TableCell>
                  <TableCell>
                    <Badge variant={s.archivedAt ? "neutral" : "positive"}>
                      {s.archivedAt ? "Archivée" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DateTimeFr value={s.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      {canWrite(ctx.role) ? (
        <Section title="Nouvelle étude">
          <CreateStudyForm labSlug={labSlug} projectId={project.id} />
        </Section>
      ) : null}
    </>
  );
}
