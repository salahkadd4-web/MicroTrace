import { Building2 } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { NumberFr } from "@/components/app/NumberFr";
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
<Section title="Laboratoires">
        {labs.length === 0 ? (
          <EmptyState
            icon={Building2}
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
                  <TableCell className="font-mono text-xs">{l.slug}</TableCell>
                  <TableCell>
                    <Badge variant={l.suspended ? "destructive" : "positive"}>
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
      </Section>
      <Section title="Créer un laboratoire">
        <CreateLaboratoryForm />
      </Section>
      {orphans.length > 0 ? (
        <Section
          title="Nouvelle invitation du responsable"
          description={`Laboratoires sans responsable : ${orphans.map((l) => l.name).join(", ")}.`}
        >
          <ReinviteForm labs={orphans.map((l) => ({ id: l.id, name: l.name }))} />
        </Section>
      ) : null}
    </>
  );
}
