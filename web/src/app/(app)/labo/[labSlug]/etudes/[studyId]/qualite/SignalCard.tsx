import { DateTimeFr } from "@/components/app/DateTimeFr";
import { NumberFr } from "@/components/app/NumberFr";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DETECTION_STATUS_LABELS, labelOf, MATRIX_LABELS } from "@/lib/labels";
import { polymerLabel } from "@/lib/polymer-labels";
import { decisionOfStatus } from "@/lib/quality";
import { unitLabel } from "@/lib/units";
import type { QualitySignal } from "@/server/engine/client";
import type { QualityDecisionView } from "@/server/quality";
import { DecisionForm } from "./DecisionForm";
import { EntryErrorNotice } from "./EntryErrorNotice";

/** Au plus ce nombre de mesures concernées est listé par signal. */
const MAX_RECORDS = 200;

export function groupLabel(g: QualitySignal["group"]): string {
  const matrix = `${labelOf(MATRIX_LABELS, g.matrix)}${g.matrix_detail ? ` (${g.matrix_detail})` : ""}`;
  return [g.method, matrix, unitLabel(g.canonical_unit)].join(" · ");
}

/** Décision enregistrée (badge, note, auteur, date), ou « Non examiné ». */
function DecisionSummary({
  decision,
  importsHref,
}: {
  decision: QualityDecisionView | null;
  importsHref: string | null;
}) {
  if (!decision) return <Badge variant="neutral">Non examiné</Badge>;
  const { label, badge } = decisionOfStatus(decision.status);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={badge}>{label}</Badge>
        <span className="text-muted-foreground">
          par {decision.decidedBy ?? "—"}, le <DateTimeFr value={decision.decidedAt} />
        </span>
        {decision.count > 1 ? (
          <span className="text-muted-foreground">({decision.count} décisions, voir le Journal)</span>
        ) : null}
      </div>
      {decision.note ? <p className="whitespace-pre-line text-sm">{decision.note}</p> : null}
      {decision.status === "accepted" ? <EntryErrorNotice importsHref={importsHref} /> : null}
    </div>
  );
}

export function SignalCard({
  signal,
  decision,
  importNames,
  labSlug,
  studyId,
  canDecide,
}: {
  signal: QualitySignal;
  decision: QualityDecisionView | null;
  importNames: Record<string, string>;
  labSlug: string;
  studyId: string;
  canDecide: boolean;
}) {
  const records = signal.records.slice(0, MAX_RECORDS);
  return (
    <li className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-base font-medium">
          {signal.subject_label} — {polymerLabel(signal.group.polymer)}
        </h4>
        <Badge variant="outline" className="h-auto whitespace-normal">{groupLabel(signal.group)}</Badge>
      </div>
      <p className="text-sm">{signal.explanation}</p>

      {signal.figures.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {signal.figures.map((f) => (
            <div key={f.name} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd>
                <NumberFr engine value={f.value} />
                {f.unit ? <> {unitLabel(f.unit)}</> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <details>
        <summary className="cursor-pointer text-sm font-medium text-primary">
          Mesures concernées ({signal.records.length})
        </summary>
        <Table>
          <TableCaption className="sr-only">
            Mesures concernées — {signal.subject_label}, {polymerLabel(signal.group.polymer)}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Fichier</TableHead>
              <TableHead className="text-right">Ligne</TableHead>
              <TableHead>Colonne</TableHead>
              <TableHead>Aliquote</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Valeur</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r, i) => (
              <TableRow key={`${r.import_id}|${r.sheet}|${r.source_row}|${r.source_column}|${i}`}>
                <TableCell>{importNames[r.import_id] ?? "Import retiré"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.source_row}</TableCell>
                <TableCell>{r.source_column}</TableCell>
                <TableCell>{r.aliquot || "—"}</TableCell>
                <TableCell>{labelOf(DETECTION_STATUS_LABELS, r.status)}</TableCell>
                <TableCell className="text-right">
                  {r.status === "quantified" && r.canonical_value !== null ? (
                    <>
                      <NumberFr engine value={r.canonical_value} /> {unitLabel(r.canonical_unit)}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {signal.records.length > MAX_RECORDS ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {MAX_RECORDS} premières mesures sur {signal.records.length}.
          </p>
        ) : null}
      </details>

      <DecisionSummary
        decision={decision}
        importsHref={canDecide ? `/labo/${labSlug}/etudes/${studyId}/imports` : null}
      />

      {canDecide ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-primary">
            Enregistrer une décision
          </summary>
          <div className="mt-3">
            <DecisionForm labSlug={labSlug} studyId={studyId} signalKey={signal.key} />
          </div>
        </details>
      ) : null}
    </li>
  );
}
