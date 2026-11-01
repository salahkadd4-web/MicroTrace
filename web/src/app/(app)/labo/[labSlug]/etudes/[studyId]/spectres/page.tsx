import { ScanLine } from "lucide-react";
import Link from "next/link";
import { DateTimeFr, formatDateTimeFr } from "@/components/app/DateTimeFr";
import { EmptyState } from "@/components/app/EmptyState";
import { formatNumberFr, formatPercentFr } from "@/components/app/NumberFr";
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
import { ENGINE_DOWN } from "@/lib/engine-messages";
import { canWrite } from "@/lib/roles";
import { SPECTRAL_STATUS_BADGES, citationText, spectralDecisionBadge } from "@/lib/spectral";
import type { SpectralModelInfo } from "@/server/engine/client";
import { requireLab } from "@/server/lab-context";
import { getSpectralModel, listSpectralAnalyses } from "@/server/spectral";
import { getTrainingConsent } from "@/server/training-consent";
import { loadStudy } from "../load-study";
import { AnalyzeForm } from "./AnalyzeForm";

/** Phrases fixes de l'écran ; tout le reste vient du moteur. */
const VALIDATE_SENTENCE =
  "Chaque proposition est à valider par une personne compétente ; elle n'est jamais enregistrée comme mesure.";
const NO_TRAINING_SENTENCE =
  "Pendant la phase d'essai, aucune donnée de laboratoire ne sert à entraîner un modèle.";

function consentSentence(consent: { granted: boolean; grantedAt: Date | null }): string {
  const base = "Utilisation des données validées de ce laboratoire pour améliorer les modèles :";
  if (!consent.granted) return `${base} désactivée.`;
  return `${base} activée depuis le ${formatDateTimeFr(consent.grantedAt) ?? "—"} (réglage du responsable du laboratoire).`;
}

/** Texte destiné aux membres du laboratoire : jamais la commande d'entraînement du moteur. */
function unavailableText(info: SpectralModelInfo): string {
  if (info.reason === "missing") {
    return "Le modèle spectral n'est pas installé : contactez l'équipe MicroTrace.";
  }
  return info.message ?? ENGINE_DOWN;
}

function TrialAlert({ info }: { info: SpectralModelInfo }) {
  return (
    <Alert variant="info">
      <AlertDescription>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{info.trial_label}</Badge>
            <span>Version du modèle : {info.version}</span>
          </div>
          <p>{info.trial_sentence}</p>
          <p>{VALIDATE_SENTENCE}</p>
          <ul className="list-disc space-y-1 pl-5">
            {info.limits
              .filter((l) => l !== info.trial_sentence)
              .map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <p>{NO_TRAINING_SENTENCE}</p>
        </div>
      </AlertDescription>
    </Alert>
  );
}

const threshold = (v: number) => formatNumberFr(v, 2);

function thresholdsText(t: SpectralModelInfo["techniques"][number]["thresholds"]): string {
  const margin =
    t.identified_min_margin > 0
      ? ` avec un écart d'au moins ${threshold(t.identified_min_margin)} sur le suivant`
      : " sans écart minimal exigé sur le suivant";
  const classifier = t.classifier_agreement_required ? " et l'accord du classifieur" : "";
  return `incertain à partir d'une corrélation de ${threshold(t.uncertain_min_score)} ; identifié à partir de ${threshold(t.identified_min_score)},${margin}${classifier}`;
}

function ModelCard({ info }: { info: SpectralModelInfo }) {
  return (
    <Section title={`Fiche du modèle (version ${info.version})`}>
      <div className="space-y-5">
        {info.techniques.map((t) => (
          <div key={t.technique} className="space-y-2">
            <h3 className="text-base font-medium">{t.label}</h3>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(0,16rem)_1fr]">
              <dt className="text-muted-foreground">Polymères évalués</dt>
              <dd>{t.polymers.map((p) => p.label).join(", ")}</dd>
              {t.unevaluated_polymers.length > 0 ? (
                <>
                  <dt className="text-muted-foreground">
                    Présents dans une seule bibliothèque (non évalués)
                  </dt>
                  <dd>
                    {t.unevaluated_polymers.map((p) => p.label).join(", ")}. Aucune mesure de
                    performance n&apos;existe pour eux : les chiffres ci-dessous ne les concernent
                    pas.
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Seuils</dt>
              <dd>{thresholdsText(t.thresholds)}</dd>
              {t.metrics ? (
                <>
                  <dt className="text-muted-foreground">Premier choix correct</dt>
                  <dd>
                    {formatPercentFr(t.metrics.top1)} (trois premiers :{" "}
                    {formatPercentFr(t.metrics.top3)}), sur {formatNumberFr(t.metrics.n_in_library)}{" "}
                    spectres de la bibliothèque, en laissant chaque jeu de données de côté tour à
                    tour
                  </dd>
                  {t.metrics.nested_identified_precision_min !== null &&
                  t.metrics.nested_identified_precision_max !== null ? (
                    <>
                      <dt className="text-muted-foreground">Précision de « identifié »</dt>
                      <dd>
                        entre {formatPercentFr(t.metrics.nested_identified_precision_min)} et{" "}
                        {formatPercentFr(t.metrics.nested_identified_precision_max)} (estimation)
                      </dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">Part d&apos;abstention</dt>
                  <dd>
                    {formatPercentFr(t.metrics.status_in_library.not_identified)} dans la
                    bibliothèque
                    {t.metrics.status_out_of_library
                      ? `, ${formatPercentFr(t.metrics.status_out_of_library.not_identified)} hors bibliothèque (n = ${formatNumberFr(t.metrics.n_out_of_library)})`
                      : ""}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        ))}
        <div className="space-y-2">
          <h3 className="text-base font-medium">Bibliothèques de référence</h3>
          <ul className="space-y-2 text-sm">
            {info.libraries.map((lib) => (
              <li key={lib.code}>
                <span className="font-medium">{lib.name}</span> : {citationText(lib.citation)}{" "}
                <span className="text-muted-foreground">
                  Licence : {lib.licence_text}
                  {lib.curve_allowed ? "" : " (courbes non affichées)"}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">
          Fiche complète : {info.card_path} (documentation du projet).
        </p>
      </div>
    </Section>
  );
}

export default async function SpectresPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);
  const archived = study.archivedAt !== null;
  const [model, list, consent] = await Promise.all([
    getSpectralModel(ctx),
    listSpectralAnalyses(ctx, study.id),
    getTrainingConsent(ctx),
  ]);
  const writable = canWrite(ctx.role) && !archived;

  return (
    <div className="space-y-6">
      {model.kind === "ok" ? (
        <TrialAlert info={model.info} />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>
            {model.kind === "engine_down" ? ENGINE_DOWN : unavailableText(model.info)}
          </AlertDescription>
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">{consentSentence(consent)}</p>
      {archived ? (
        <Alert variant="info">
          <AlertDescription>
            Étude archivée : les analyses et décisions sont en lecture seule.
          </AlertDescription>
        </Alert>
      ) : null}

      {writable && model.kind === "ok" ? (
        <Section title="Analyser un spectre">
          <AnalyzeForm labSlug={labSlug} studyId={study.id} />
        </Section>
      ) : null}

      <Section title="Analyses de l'étude">
        {list.rows.length === 0 ? (
          <EmptyState icon={ScanLine} title="Aucun spectre analysé dans cette étude." />
        ) : (
          <>
            <Table>
              <TableCaption className="sr-only">Analyses spectrales de l&apos;étude</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Fichier</TableHead>
                  <TableHead>Technique</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Proposition</TableHead>
                  <TableHead>Décision</TableHead>
                  <TableHead className="sticky right-0 bg-muted">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((r) => {
                  const decision = spectralDecisionBadge(r.decision?.decision ?? null);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <DateTimeFr value={r.createdAt} />
                      </TableCell>
                      <TableCell className="min-w-32 whitespace-normal break-all">
                        {r.fileName}
                      </TableCell>
                      <TableCell>{r.techniqueLabel}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            SPECTRAL_STATUS_BADGES[r.status as keyof typeof SPECTRAL_STATUS_BADGES] ??
                            "neutral"
                          }
                        >
                          {r.statusLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-32 whitespace-normal">
                        {r.proposedLabel ?? "Aucune proposition fiable"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={decision.badge}>{decision.label}</Badge>
                      </TableCell>
                      <TableCell className="sticky right-0 bg-card shadow-[inset_1px_0_0_var(--border)]">
                        <Link
                          href={`/labo/${labSlug}/etudes/${study.id}/spectres/${r.id}`}
                          aria-label={`Ouvrir l'analyse du ${formatDateTimeFr(r.createdAt) ?? ""}`}
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Voir
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {list.hidden > 0 ? (
              <p className="text-sm text-muted-foreground">
                {list.hidden} analyses plus anciennes non affichées.
              </p>
            ) : null}
          </>
        )}
      </Section>

      {model.kind === "ok" ? <ModelCard info={model.info} /> : null}
    </div>
  );
}
