import { FlaskConical, Gauge, Layers } from "lucide-react";
import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { NumberFr } from "@/components/app/NumberFr";
import { Section } from "@/components/app/Section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BLANK_CORRECTED_LABELS, NATURE_LABELS, QC_KIND_LABELS, TECHNIQUE_LABELS, labelOf } from "@/lib/labels";
import { unitLabel } from "@/lib/units";
import { requireLab } from "@/server/lab-context";
import { canWrite } from "@/lib/roles";
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
  RemoveQcButton,
} from "./forms";

export default async function ParametresPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);
  const writable = canWrite(ctx.role);
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
        <Alert variant="info">
          <AlertDescription>Étude archivée : lecture seule.</AlertDescription>
        </Alert>
      ) : null}
      <fieldset disabled={archived} className="min-w-0 space-y-6">
        <Section title="Méthodes">
          {methods.length === 0 ? (
            <EmptyState icon={FlaskConical} title="Aucune méthode définie." />
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
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{labelOf(TECHNIQUE_LABELS, m.technique)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {writable ? <AddMethodForm labSlug={labSlug} studyId={study.id} /> : null}
        </Section>

        <Section title="Limites de détection">
          {limits.length === 0 ? (
            <EmptyState icon={Gauge} title="Aucune limite de détection définie." />
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
                      {writable ? <RemoveLimitButton labSlug={labSlug} limitId={l.id} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {writable && methods.length > 0 ? (
            <AddLimitForm
              labSlug={labSlug}
              studyId={study.id}
              methods={methods.map((m) => ({ id: m.id, name: m.name }))}
            />
          ) : null}
          {writable && methods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ajoutez d&apos;abord une méthode pour saisir ses limites.
            </p>
          ) : null}
          {writable ? <PrefillForm labSlug={labSlug} studyId={study.id} /> : null}
        </Section>

        <Section title="Contrôles qualité">
          {study.qcSummaries.length === 0 ? (
            <EmptyState icon={Layers} title="Aucun contrôle qualité résumé." />
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
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
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
                    <TableCell>
                      {writable ? <RemoveQcButton labSlug={labSlug} qcId={q.id} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {writable ? <AddQcForm labSlug={labSlug} studyId={study.id} /> : null}
        </Section>

        <Section title="Référence">
          {writable ? (
            <ReferenceForm
              labSlug={labSlug}
              studyId={study.id}
              defaults={{
                title: study.title,
                nature: study.nature,
                referenceDoi: study.referenceDoi ?? "",
                referenceLicense: study.referenceLicense ?? "",
                blankCorrected: study.blankCorrected,
              }}
            />
          ) : (
            <dl className="grid max-w-xl grid-cols-[12rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Nature des données</dt>
              <dd>{labelOf(NATURE_LABELS, study.nature)}</dd>
              <dt className="text-muted-foreground">DOI de référence</dt>
              <dd>{study.referenceDoi || "—"}</dd>
              <dt className="text-muted-foreground">Licence de référence</dt>
              <dd>{study.referenceLicense || "—"}</dd>
              <dt className="text-muted-foreground">Correction du blanc</dt>
              <dd>{labelOf(BLANK_CORRECTED_LABELS, study.blankCorrected)}</dd>
            </dl>
          )}
        </Section>

        <Section title="Pseudonymisation">
          {study.pseudonymDeclaredAt ? (
            <p className="text-sm">
              Pseudonymisation déclarée le <DateTimeFr value={study.pseudonymDeclaredAt} /> par{" "}
              {study.pseudonymDeclaredByName ?? "—"}.
            </p>
          ) : writable ? (
            <PseudonymisationControl labSlug={labSlug} studyId={study.id} />
          ) : (
            <p className="text-sm text-muted-foreground">Pseudonymisation non déclarée.</p>
          )}
        </Section>

        {writable ? (
          <Section title="Archivage">
            <ArchiveControl labSlug={labSlug} studyId={study.id} />
          </Section>
        ) : null}
      </fieldset>
    </>
  );
}
