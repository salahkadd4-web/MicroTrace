import { DateTimeFr } from "@/components/app/DateTimeFr";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { Section } from "@/components/app/Section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auditActionLabel, auditObjectName, diffChanges, entityTypeLabel } from "@/lib/audit-labels";
import { listAuditEvents } from "@/server/audit";
import { requireLab } from "@/server/lab-context";
import { loadStudy } from "../load-study";
import { AuditDetails } from "./AuditDetails";

export default async function JournalPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  const study = await loadStudy(labSlug, studyId);
  const ctx = await requireLab(labSlug);
  const events = await listAuditEvents(ctx, study.id);
  const labels = { methodNames: new Map((study.methods ?? []).map((m) => [m.id, m.name])) };
  return (
    <Section title="Journal">
      {events.length === 0 ? (
        <EmptyState icon={ScrollText} title="Aucun événement enregistré." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Auteur</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Objet</TableHead>
              <TableHead>
                <span className="sr-only">Détails</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => {
              const label = auditActionLabel(e.action);
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <DateTimeFr value={e.createdAt} />
                  </TableCell>
                  <TableCell className="min-w-32 whitespace-normal">{e.actorName ?? "—"}</TableCell>
                  <TableCell>{label}</TableCell>
                  <TableCell className="min-w-32 whitespace-normal">
                    {auditObjectName(e, labels) ?? entityTypeLabel(e.entityType)}
                  </TableCell>
                  <TableCell className="text-right">
                    <AuditDetails title={label} changes={diffChanges(e.before, e.after, labels)} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
