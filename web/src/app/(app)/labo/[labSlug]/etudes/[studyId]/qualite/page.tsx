import { ShieldCheck } from "lucide-react";
import { DateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { Section } from "@/components/app/Section";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  CONTEXT_CHANGED,
  ENGINE_DOWN,
  NO_SAMPLE_MEASUREMENTS,
  QUALITY_REFUSED,
  STUDY_TOO_LARGE,
} from "@/lib/engine-messages";
import { decisionOfStatus } from "@/lib/quality";
import { canWrite } from "@/lib/roles";
import { EngineError, EngineUnavailableError } from "@/server/engine/client";
import { requireLab } from "@/server/lab-context";
import { getStudyQuality, type QualityDecisionView, type StudyQuality } from "@/server/quality";
import { loadStudy } from "../load-study";
import { SignalCard } from "./SignalCard";

/** Au plus ce nombre de signaux est affiché par règle. */
const MAX_SIGNALS_PER_RULE = 200;

function DisappearedSection({ items }: { items: QualityDecisionView[] }) {
  if (items.length === 0) return null;
  return (
    <Section
      title="Signaux disparus"
      description="Décisions dont le signal n'apparaît plus avec les mesures actuelles (import retiré, fichier corrigé, contrôles ou règles modifiés). Elles sont conservées."
    >
      <Table>
        <TableCaption className="sr-only">Décisions dont le signal a disparu</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Règle</TableHead>
            <TableHead>Objet</TableHead>
            <TableHead>Décision</TableHead>
            <TableHead>Note</TableHead>
            <TableHead>Par</TableHead>
            <TableHead>Le</TableHead>
            <TableHead>Version des règles</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d) => {
            const { label, badge } = decisionOfStatus(d.status);
            return (
              <TableRow key={d.id}>
                <TableCell>{d.signal?.title ?? "—"}</TableCell>
                <TableCell>{d.signal?.subject_label ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={badge}>{label}</Badge>
                </TableCell>
                <TableCell className="whitespace-pre-line">{d.note ?? "—"}</TableCell>
                <TableCell>{d.decidedBy ?? "—"}</TableCell>
                <TableCell>
                  <DateTimeFr value={d.decidedAt} />
                </TableCell>
                <TableCell>{d.modelVersion}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Section>
  );
}

function Quality({
  data,
  labSlug,
  studyId,
  canDecide,
}: {
  data: Extract<StudyQuality, { kind: "ok" }>;
  labSlug: string;
  studyId: string;
  canDecide: boolean;
}) {
  const ruleOrder = [...new Set(data.signals.map((s) => s.signal.rule))];
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="neutral">Règles d&apos;essai</Badge>
          <span className="text-muted-foreground">Version des règles : {data.version}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Règles documentées, appliquées à titre d&apos;essai ; vos décisions ne servent à aucun
          entraînement pendant cette phase.{" "}
          <a
            href="#regles-de-qualite"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Limites des règles
          </a>
        </p>
      </div>

      <Alert variant="info">
        <AlertDescription>
          Ces signaux sont des propositions calculées par des règles statistiques documentées (règles
          de qualité {data.version}), pas des verdicts : chacun est à examiner par une personne
          compétente. Ils sont recalculés à chaque ouverture à partir des imports actifs ; seules les
          décisions sont enregistrées.
        </AlertDescription>
      </Alert>
      {data.mixedRulesVersions ? (
        <Alert variant="warning">
          <AlertDescription>
            Les imports actifs ont été contrôlés avec des versions de règles différentes entre
            imports : les statuts ne sont pas forcément comparables.
          </AlertDescription>
        </Alert>
      ) : null}
      {data.contextChanged ? (
        <Alert variant="warning">
          <AlertDescription>{CONTEXT_CHANGED}</AlertDescription>
        </Alert>
      ) : null}
      {data.archived ? (
        <Alert variant="info">
          <AlertDescription>Étude archivée : les décisions sont en lecture seule.</AlertDescription>
        </Alert>
      ) : null}

      <Section title="Signaux" description={`${data.signals.length} signaux — règles ${data.version}`}>
        {data.signals.length === 0 ? (
          <p className="text-sm">
            Aucun signal avec les règles {data.version}. Les règles non appliquées sont listées
            ci-dessous.
          </p>
        ) : (
          <div className="space-y-6">
            {ruleOrder.map((rule) => {
              const items = data.signals.filter((s) => s.signal.rule === rule);
              const shown = items.slice(0, MAX_SIGNALS_PER_RULE);
              return (
                <div key={rule} className="space-y-3">
                  <h3 className="text-base font-medium">{items[0].signal.title}</h3>
                  <ul className="space-y-3">
                    {shown.map(({ signal, decision }) => (
                      <SignalCard
                        key={signal.key}
                        signal={signal}
                        decision={decision}
                        importNames={data.importNames}
                        labSlug={labSlug}
                        studyId={studyId}
                        canDecide={canDecide}
                      />
                    ))}
                  </ul>
                  {items.length > shown.length ? (
                    <p className="text-sm text-muted-foreground">
                      {items.length - shown.length} autres signaux non affichés.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Règles non appliquées ou sans objet">
        {data.notes.length === 0 ? (
          <p className="text-sm">Aucune.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {data.notes.map((n, i) => (
              <li key={i}>{n.message}</li>
            ))}
          </ul>
        )}
      </Section>

      <DisappearedSection items={data.disappeared} />

      <div id="regles-de-qualite">
        <Section title={`Règles de qualité (version ${data.version})`}>
          <div className="space-y-4">
            {data.rules.map((r) => (
              <div key={r.rule} className="space-y-2">
                <h3 className="text-base font-medium">{r.title}</h3>
                <p className="text-sm">{r.description}</p>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-primary">
                    Limites connues
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {r.limits.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
            <p className="text-sm text-muted-foreground">
              Fiche des règles complète : docs/models/c7-qualite.md (documentation du projet).
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}

export default async function QualitePage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);

  let data: StudyQuality;
  try {
    data = await getStudyQuality(ctx, study.id);
  } catch (e) {
    // Messages fixes : jamais le détail renvoyé par le moteur. Tout le reste est relancé.
    if (e instanceof EngineUnavailableError || e instanceof EngineError) {
      return (
        <Alert variant="destructive">
          <AlertDescription>
            {e instanceof EngineError
              ? e.status === 413
                ? STUDY_TOO_LARGE
                : QUALITY_REFUSED
              : ENGINE_DOWN}
          </AlertDescription>
        </Alert>
      );
    }
    throw e;
  }

  if (data.kind === "empty") {
    return (
      <div className="space-y-6">
        <EmptyState icon={ShieldCheck} title={NO_SAMPLE_MEASUREMENTS} />
        <DisappearedSection items={data.disappeared} />
      </div>
    );
  }
  const canDecide = canWrite(ctx.role) && !data.archived;
  return <Quality data={data} labSlug={labSlug} studyId={study.id} canDecide={canDecide} />;
}
