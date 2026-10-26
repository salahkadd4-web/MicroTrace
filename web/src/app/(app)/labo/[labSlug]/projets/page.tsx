import Link from "next/link";
import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { NumberFr } from "@/components/app/NumberFr";
import { PageHeader } from "@/components/app/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireLab } from "@/server/lab-context";
import { canWrite } from "@/lib/roles";
import { listProjects } from "@/server/projects";
import { CreateProjectForm } from "./CreateProjectForm";

export default async function ProjetsPage({
  params,
}: {
  params: Promise<{ labSlug: string }>;
}) {
  const { labSlug } = await params;
  const ctx = await requireLab(labSlug);
  const projects = await listProjects(ctx);
  return (
    <>
      <PageHeader title="Projets" subtitle="Prototype de recherche, pas un dispositif médical" />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Liste des projets</h2>
        {projects.length === 0 ? (
          <EmptyState
            title="Aucun projet pour le moment."
            description={canWrite(ctx.role) ? "Créez un premier projet ci-dessous." : undefined}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titre</TableHead>
                <TableHead className="text-right">Études</TableHead>
                <TableHead>Créé le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/labo/${labSlug}/projets/${p.id}`} className="underline">
                      {p.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFr value={p._count.studies} />
                  </TableCell>
                  <TableCell>
                    <DateTimeFr value={p.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      {canWrite(ctx.role) ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Nouveau projet</h2>
          <CreateProjectForm labSlug={labSlug} />
        </section>
      ) : null}
    </>
  );
}
