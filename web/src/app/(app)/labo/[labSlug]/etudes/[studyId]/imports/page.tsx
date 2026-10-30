import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { NumberFr } from "@/components/app/NumberFr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { canWrite } from "@/lib/roles";
import { engineClient } from "@/server/engine/client";
import { listImports } from "@/server/imports";
import { requireLab } from "@/server/lab-context";
import { loadStudy } from "../load-study";
import { ImportIssues } from "./ImportIssues";
import { ImportWizard } from "./ImportWizard";
import { parseDictionaryFields, type MappingField } from "./mapping-fields";
import { RetireButton } from "./RetireButton";

const ENGINE_DOWN = "Le moteur d'analyse est indisponible.";

/** Champs mappables, lus dans le dictionnaire du moteur ; null si le moteur ne répond pas. */
async function loadFields(): Promise<MappingField[] | null> {
  try {
    const fields = parseDictionaryFields((await engineClient.dictionary()).csv);
    return fields.length > 0 ? fields : null;
  } catch {
    return null;
  }
}

export default async function ImportsPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);
  const archived = study.archivedAt !== null;
  const writable = canWrite(ctx.role) && !archived;
  const [imports, fields] = await Promise.all([
    listImports(ctx, study.id),
    writable ? loadFields() : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-8">
      {archived ? (
        <Alert>
          <AlertDescription>Étude archivée : lecture seule.</AlertDescription>
        </Alert>
      ) : null}

      {writable ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Nouvel import</h2>
          {fields ? (
            <ImportWizard labSlug={labSlug} studyId={study.id} fields={fields} />
          ) : (
            <Alert variant="destructive">
              <AlertDescription>{ENGINE_DOWN}</AlertDescription>
            </Alert>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Imports</h2>
        {imports.length === 0 ? (
          <EmptyState title="Aucun import pour cette étude." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fichier</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Auteur</TableHead>
                <TableHead className="text-right">Lignes</TableHead>
                <TableHead className="text-right">Mesures</TableHead>
                <TableHead className="text-right">Erreurs</TableHead>
                <TableHead className="text-right">Avertissements</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.fileName}</TableCell>
                  <TableCell>
                    <DateTimeFr value={r.createdAt} />
                  </TableCell>
                  <TableCell>{r.createdByName ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {r.nRows === null ? "—" : <NumberFr value={r.nRows} />}
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFr value={r.measurementCount + r.qcMeasurementCount} />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFr value={r.errorCount} />
                  </TableCell>
                  <TableCell className="text-right">
                    <NumberFr value={r.warningCount} />
                  </TableCell>
                  <TableCell>
                    {r.status === "active" ? (
                      <Badge variant="secondary">Actif</Badge>
                    ) : (
                      <div className="space-y-1">
                        <Badge variant="outline">Retiré</Badge>
                        <p className="text-xs whitespace-normal text-muted-foreground">
                          {r.retiredReason}
                          {r.retiredAt ? (
                            <>
                              {" · "}
                              <DateTimeFr value={r.retiredAt} />
                            </>
                          ) : null}
                        </p>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <ImportIssues labSlug={labSlug} importRunId={r.id} fileName={r.fileName} />
                      {writable && r.status === "active" ? (
                        <RetireButton labSlug={labSlug} importRunId={r.id} fileName={r.fileName} />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
