import { EmptyState } from "@/components/app/EmptyState";
import { NumberFr } from "@/components/app/NumberFr";
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
import { listLaboratories } from "@/server/platform";
import { requirePlatformAdmin } from "@/server/platform-action";
import { CreateLaboratoryForm, ReinviteForm, SuspendButton } from "./controls";

export default async function AdminPage() {
  const admin = await requirePlatformAdmin();
  const labs = await listLaboratories(admin);
  const orphans = labs.filter((l) => l.admins === 0);
  return (
    <>
      <PageHeader
        title="Console de la plateforme"
        subtitle="Compteurs seulement : aucune donnée scientifique des laboratoires n'est affichée."
      />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Laboratoires</h2>
        {labs.length === 0 ? (
          <EmptyState
            title="Aucun laboratoire pour le moment."
            description="Créez le premier laboratoire ci-dessous."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Membres</TableHead>
                <TableHead className="text-right">Études</TableHead>
                <TableHead className="text-right">Imports</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell>{l.slug}</TableCell>
                  <TableCell>
                    <Badge variant={l.suspended ? "destructive" : "secondary"}>
                      {l.suspended ? "Suspendu" : "Actif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFr value={l.members} />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFr value={l.studies} />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFr value={l.imports} />
                  </TableCell>
                  <TableCell>
                    <SuspendButton laboratoryId={l.id} name={l.name} suspended={l.suspended} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Créer un laboratoire</h2>
        <CreateLaboratoryForm />
      </section>
      {orphans.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Nouvelle invitation du responsable</h2>
          <p className="text-sm text-muted-foreground">
            Laboratoires sans responsable : {orphans.map((l) => l.name).join(", ")}.
          </p>
          <ReinviteForm labs={orphans.map((l) => ({ id: l.id, name: l.name }))} />
        </section>
      ) : null}
    </>
  );
}
