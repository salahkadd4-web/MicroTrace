import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { NumberFr } from "@/components/app/NumberFr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QC_KIND_LABELS, TECHNIQUE_LABELS, labelOf } from "@/lib/labels";
import { unitLabel } from "@/lib/units";
import { loadStudy } from "../load-study";
import {
  AddLimitForm,
  AddMethodForm,
  AddQcForm,
  ArchiveControl,
  PrefillForm,
  PseudonymisationControl,
  ReferenceForm,
  RemoveLimitButton,
} from "./forms";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function ParametresPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const study = await loadStudy(studyId);
  const archived = study.archivedAt !== null;
  const methods = [...study.methods].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const methodName = new Map(methods.map((m) => [m.id, m.name]));
  const limits = [...study.limits].sort(
    (a, b) =>
      (methodName.get(a.methodId) ?? "").localeCompare(methodName.get(b.methodId) ?? "", "fr") ||
      a.polymer.localeCompare(b.polymer, "fr"),
  );

  return (
    <>
      {archived ? (
        <Alert>
          <AlertDescription>Étude archivée : lecture seule.</AlertDescription>
        </Alert>
      ) : null}
      <fieldset disabled={archived} className="min-w-0 space-y-8">
        <Section title="Méthodes">
          {methods.length === 0 ? (
            <EmptyState title="Aucune méthode définie." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Technique</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {methods.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.name}</TableCell>
                    <TableCell>{labelOf(TECHNIQUE_LABELS, m.technique)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <AddMethodForm studyId={study.id} />
        </Section>

        <Section title="Limites de détection">
          {limits.length === 0 ? (
            <EmptyState title="Aucune limite de détection définie." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Méthode</TableHead>
                  <TableHead>Polymère</TableHead>
                  <TableHead className="text-right">LOD</TableHead>
                  <TableHead className="text-right">LOQ</TableHead>
                  <TableHead>Unité</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {limits.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{methodName.get(l.methodId) ?? "—"}</TableCell>
                    <TableCell>{l.polymer}</TableCell>
                    <TableCell className="text-right">
                      <NumberFr value={l.lod} />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberFr value={l.loq} />
                    </TableCell>
                    <TableCell>{unitLabel(l.unitCode)}</TableCell>
                    <TableCell>{l.source}</TableCell>
                    <TableCell>
                      <RemoveLimitButton studyId={study.id} limitId={l.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {methods.length > 0 ? (
            <AddLimitForm
              studyId={study.id}
              methods={methods.map((m) => ({ id: m.id, name: m.name }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Ajoutez d&apos;abord une méthode pour saisir ses limites.
            </p>
          )}
          <PrefillForm studyId={study.id} />
        </Section>

        <Section title="Contrôles qualité">
          {study.qcSummaries.length === 0 ? (
            <EmptyState title="Aucun contrôle qualité résumé." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Polymère</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">n</TableHead>
                  <TableHead className="text-right">Moyenne</TableHead>
                  <TableHead className="text-right">Écart type</TableHead>
                  <TableHead>Unité</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {study.qcSummaries.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell>{q.polymer}</TableCell>
                    <TableCell>{labelOf(QC_KIND_LABELS, q.kind)}</TableCell>
                    <TableCell className="text-right">
                      <NumberFr value={q.n} />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberFr value={q.mean} />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberFr value={q.sd} />
                    </TableCell>
                    <TableCell>{unitLabel(q.unitCode)}</TableCell>
                    <TableCell>{q.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <AddQcForm studyId={study.id} />
        </Section>

        <Section title="Référence">
          <ReferenceForm
            studyId={study.id}
            defaults={{
              title: study.title,
              nature: study.nature,
              referenceDoi: study.referenceDoi ?? "",
              referenceLicense: study.referenceLicense ?? "",
              blankCorrected: study.blankCorrected,
            }}
          />
        </Section>

        <Section title="Pseudonymisation">
          {study.pseudonymDeclaredAt ? (
            <p className="text-sm">
              Pseudonymisation déclarée le <DateTimeFr value={study.pseudonymDeclaredAt} /> par{" "}
              {study.pseudonymDeclaredByName ?? "—"}.
            </p>
          ) : (
            <PseudonymisationControl studyId={study.id} />
          )}
        </Section>

        <Section title="Archivage">
          <ArchiveControl studyId={study.id} />
        </Section>
      </fieldset>
    </>
  );
}
