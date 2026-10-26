import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
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
import { loadStudy } from "../load-study";
import { AuditDetails } from "./AuditDetails";

export default async function JournalPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  const study = await loadStudy(studyId);
  const events = await listAuditEvents(study.id);
  const ctx = { methodNames: new Map((study.methods ?? []).map((m) => [m.id, m.name])) };
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Journal</h2>
      {events.length === 0 ? (
        <EmptyState title="Aucun événement enregistré." />
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
                  <TableCell>{e.actorName ?? "—"}</TableCell>
                  <TableCell>{label}</TableCell>
                  <TableCell>{auditObjectName(e, ctx) ?? entityTypeLabel(e.entityType)}</TableCell>
                  <TableCell className="text-right">
                    <AuditDetails title={label} changes={diffChanges(e.before, e.after, ctx)} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
