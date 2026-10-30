import { ChartColumnBig } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/EmptyState";
import { formatEngineNumberFr, formatPercentFr, NumberFr } from "@/components/app/NumberFr";
import { Section } from "@/components/app/Section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BASIS_LABELS,
  DETECTION_STATUS_LABELS,
  labelOf,
  MATRIX_LABELS,
  QUANTITY_KIND_LABELS,
} from "@/lib/labels";
import {
  ENGINE_DOWN,
  ENGINE_REFUSED,
  NO_SAMPLE_MEASUREMENTS,
  STUDY_TOO_LARGE,
} from "@/lib/engine-messages";
import { polymerLabel } from "@/lib/polymer-labels";
import { canWrite } from "@/lib/roles";
import { unitLabel } from "@/lib/units";
import { EngineError, EngineUnavailableError } from "@/server/engine/client";
import { requireLab } from "@/server/lab-context";
import { getStudyResults, type StudyResults } from "@/server/results";
import { loadStudy } from "../load-study";
import { groupFrequencies, groupResults, type ResultGroup } from "./group-results";
import { FrequencyChart, SamplePointsChart } from "./ResultCharts";

/** Au-delà, le tableau « Voir les données » est tronqué (poids de la page) ; le CSV reste complet. */
const MAX_TABLE_ROWS = 500;

const CONTEXT_CHANGED =
  "Les paramètres de l'étude (méthodes ou limites) ont changé depuis certains imports : les statuts restent ceux calculés lors de chaque import.";

const matrixName = (matrix: string, detail: string) =>
  `${labelOf(MATRIX_LABELS, matrix)}${detail ? ` (${detail})` : ""}`;

function groupTitle(g: ResultGroup) {
  return [
    g.method,
    matrixName(g.matrix, g.matrixDetail),
    `${labelOf(QUANTITY_KIND_LABELS, g.kind)} ${labelOf(BASIS_LABELS, g.basis)}`,
    unitLabel(g.unit),
  ].join(" · ");
}

/** Colonnes de statut : celles que le moteur renvoie, dans l'ordre d'affichage habituel. */
function statusColumns(g: ResultGroup): string[] {
  const present = new Set(g.stats.flatMap((s) => Object.keys(s.counts_by_status)));
  const known = Object.keys(DETECTION_STATUS_LABELS).filter((k) => present.has(k));
  const others = [...present].filter((k) => !(k in DETECTION_STATUS_LABELS));
  return [...known, ...others];
}

function StatsTable({ group }: { group: ResultGroup }) {
  const unit = unitLabel(group.unit);
  const statuses = statusColumns(group);
  return (
    <Table>
      <TableCaption className="sr-only">Statistiques — {groupTitle(group)}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Polymère</TableHead>
          <TableHead className="text-right">n quantifiés</TableHead>
          <TableHead className="text-right">Min ({unit})</TableHead>
          <TableHead className="text-right">Médiane ({unit})</TableHead>
          <TableHead className="text-right">Moyenne ({unit})</TableHead>
          <TableHead className="text-right">Max ({unit})</TableHead>
          {statuses.map((s) => (
            <TableHead key={s} className="text-right">
              {labelOf(DETECTION_STATUS_LABELS, s)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {group.stats.map((s) => (
          <TableRow key={s.polymer}>
            <TableCell>{polymerLabel(s.polymer)}</TableCell>
            <TableCell className="text-right">
              <NumberFr engine value={s.n_quantified} />
            </TableCell>
            <TableCell className="text-right">
              <NumberFr engine value={s.min} />
            </TableCell>
            <TableCell className="text-right">
              <NumberFr engine value={s.median} />
            </TableCell>
            <TableCell className="text-right">
              <NumberFr engine value={s.mean} />
            </TableCell>
            <TableCell className="text-right">
              <NumberFr engine value={s.max} />
            </TableCell>
            {statuses.map((k) => (
              <TableCell key={k} className="text-right">
                <NumberFr engine value={s.counts_by_status[k] ?? 0} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PointsSection({ group }: { group: ResultGroup }) {
  const unit = unitLabel(group.unit);
  const title = groupTitle(group);
  // Seuls les échantillons quantifiés ont une valeur à tracer ; les autres statuts ne le sont jamais.
  const quantified = group.samples.filter((s) => s.status === "quantified" && s.value !== null);
  const polymerCodes = [
    ...new Set([...group.stats.map((s) => s.polymer), ...quantified.map((s) => s.polymer)]),
  ];
  const points = quantified.map((s) => ({
    sampleId: s.sample_id,
    polymerIndex: polymerCodes.indexOf(s.polymer),
    value: s.value as number,
  }));
  return (
    <div className="space-y-3">
      <h3 className="text-base font-medium">Valeurs par échantillon — {title}</h3>
      <p className="text-sm text-muted-foreground">
        Chaque point est un échantillon quantifié, en {unit}. Seuls les échantillons quantifiés sont
        tracés : les autres statuts sont comptés dans le tableau des statistiques.
      </p>
      {points.length === 0 ? (
        <p className="text-sm">Aucun échantillon quantifié dans ce groupe.</p>
      ) : (
        <>
          <SamplePointsChart
            polymers={polymerCodes.map(polymerLabel)}
            points={points}
            unit={unit}
            ariaLabel={`Valeurs par échantillon (${unit}) — ${title}`}
          />
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary">Voir les données</summary>
            <Table>
              <TableCaption className="sr-only">
                Données des valeurs par échantillon — {title}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Échantillon</TableHead>
                  <TableHead>Polymère</TableHead>
                  <TableHead className="text-right">Valeur ({unit})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quantified.slice(0, MAX_TABLE_ROWS).map((s) => (
                  <TableRow key={`${s.sample_id}|${s.polymer}`}>
                    <TableCell>{s.sample_id}</TableCell>
                    <TableCell>{polymerLabel(s.polymer)}</TableCell>
                    <TableCell className="text-right">
                      <NumberFr engine value={s.value} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {quantified.length > MAX_TABLE_ROWS ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {MAX_TABLE_ROWS} premières lignes sur {formatEngineNumberFr(quantified.length)} —
                téléchargez le CSV pour tout voir.
              </p>
            ) : null}
          </details>
        </>
      )}
    </div>
  );
}

function Results({ data }: { data: Extract<StudyResults, { empty: false }> }) {
  const { summary } = data;
  const versions = [...new Set(data.imports.map((i) => i.rulesVersion))];
  const frequencyGroups = groupFrequencies(summary);
  const groups = groupResults(summary);
  return (
    <div className="space-y-6">
      {data.mixedRulesVersions ? (
        <Alert variant="warning">
          <AlertDescription>
            Les imports actifs ont été contrôlés avec des versions de règles différentes entre
            imports : les statuts ne sont pas forcément comparables. ({versions.join(", ")})
          </AlertDescription>
        </Alert>
      ) : null}
      {data.contextChanged ? (
        <Alert variant="warning">
          <AlertDescription>{CONTEXT_CHANGED}</AlertDescription>
        </Alert>
      ) : null}

      <Section title="Règle d'agrégation">
        <p className="text-sm">{summary.aggregation_rule}</p>
      </Section>

      <Section title="Fréquences de quantification">
        <div className="space-y-8">
          {frequencyGroups.map((fg) => {
            const name = matrixName(fg.matrix, fg.matrixDetail);
            return (
              <div key={fg.key} className="space-y-3">
                <h3 className="text-base font-medium">
                  Fréquence de quantification par polymère — {name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Part des échantillons quantifiés pour chaque polymère, dans la matrice « {name} ».
                </p>
                <FrequencyChart
                  bars={fg.rows.map((r) => ({ label: polymerLabel(r.polymer), fraction: r.fraction }))}
                  ariaLabel={`Fréquence de quantification par polymère — ${name}`}
                />
                <Table>
                  <TableCaption className="sr-only">Fréquences de quantification — {name}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Polymère</TableHead>
                      <TableHead>Matrice</TableHead>
                      <TableHead className="text-right">Quantifiés / échantillons</TableHead>
                      <TableHead className="text-right">Fréquence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fg.rows.map((r) => (
                      <TableRow key={r.polymer}>
                        <TableCell>{polymerLabel(r.polymer)}</TableCell>
                        <TableCell>{name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatEngineNumberFr(r.n_quantified)}/{formatEngineNumberFr(r.n_samples)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPercentFr(r.fraction)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          })}
        </div>
      </Section>

      {groups.map((g) => (
        <Section key={g.key} title={groupTitle(g)}>
          {g.stats.length > 0 ? <StatsTable group={g} /> : null}
          <PointsSection group={g} />
        </Section>
      ))}
    </div>
  );
}

export default async function ResultatsPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);

  let data: StudyResults;
  try {
    data = await getStudyResults(ctx, study.id);
  } catch (e) {
    // Messages fixes : jamais le détail renvoyé par le moteur. Tout le reste est relancé.
    if (e instanceof EngineUnavailableError || e instanceof EngineError) {
      return (
        <Alert variant="destructive">
          <AlertDescription>
            {e instanceof EngineError
              ? e.status === 413
                ? STUDY_TOO_LARGE
                : ENGINE_REFUSED
              : ENGINE_DOWN}
          </AlertDescription>
        </Alert>
      );
    }
    throw e;
  }

  if (data.empty) {
    const canImport = canWrite(ctx.role) && study.archivedAt === null;
    return (
      <EmptyState
        icon={ChartColumnBig}
        title={NO_SAMPLE_MEASUREMENTS}
        action={
          canImport ? (
            <Link
              href={`/labo/${labSlug}/etudes/${study.id}/imports`}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Aller aux imports
            </Link>
          ) : undefined
        }
      />
    );
  }
  return <Results data={data} />;
}
