import { ImageIcon } from "lucide-react";
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
import { IMAGE_STATUS_BADGES, imageDecisionBadge } from "@/lib/images";
import { canWrite } from "@/lib/roles";
import { TRAINING_CONSENT_VERSION } from "@/lib/training-consent";
import type { ImageModelInfo } from "@/server/engine/client";
import { getImageModel, listImageAnalyses, listValidatedCounts } from "@/server/images";
import { requireLab } from "@/server/lab-context";
import { getTrainingConsent } from "@/server/training-consent";
import { loadStudy } from "../load-study";
import { AnalyzeImageForm } from "./AnalyzeImageForm";

/** Phrases fixes de l'écran ; tout le reste vient du moteur. */
const VALIDATE_SENTENCE =
  "Chaque proposition est à valider par une personne compétente ; elle n'est jamais enregistrée comme mesure.";
const NO_TRAINING_SENTENCE =
  "Pendant la phase d'essai, aucune donnée de laboratoire ne sert à entraîner un modèle.";
const COUNTS_SENTENCE =
  "Comptages issus d'images, validés par une personne. Ce ne sont pas des mesures : la nature des particules n'est pas déterminée. Ils ne figurent ni dans Résultats ni dans le rapport.";

const linkClass = "text-sm font-medium text-primary underline-offset-4 hover:underline";

function consentSentence(consent: {
  granted: boolean;
  grantedAt: Date | null;
  version: string | null;
}): string {
  const base = "Utilisation des données validées de ce laboratoire pour améliorer les modèles :";
  if (!consent.granted) return `${base} désactivée.`;
  if (consent.version !== TRAINING_CONSENT_VERSION) {
    return `${base} consentement à renouveler (texte étendu aux images) ; sans renouvellement, rien n'est exporté.`;
  }
  return `${base} activée depuis le ${formatDateTimeFr(consent.grantedAt) ?? "—"} (réglage du responsable du laboratoire).`;
}

/** Texte destiné aux membres du laboratoire : jamais la commande d'entraînement du moteur. */
function unavailableText(info: ImageModelInfo): string {
  if (info.reason === "missing") {
    return "Le modèle d'images n'est pas installé : contactez l'équipe MicroTrace.";
  }
  return info.message ?? ENGINE_DOWN;
}

function TrialAlert({ info }: { info: ImageModelInfo }) {
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

const share = (v: number | null) => (v === null ? null : formatPercentFr(v));

function ModelCard({ info }: { info: ImageModelInfo }) {
  const m = info.metrics;
  const evaluated = info.shape_vocabulary.filter((s) => s.evaluated);
  const notEvaluated = info.shape_vocabulary.filter((s) => !s.evaluated);
  const t = info.thresholds;
  return (
    <Section title={`Fiche du modèle (version ${info.version})`}>
      <div className="space-y-4">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(0,16rem)_1fr]">
          <dt className="text-muted-foreground">Formes évaluées</dt>
          <dd>{evaluated.map((s) => s.label).join(", ")}</dd>
          {notEvaluated.length > 0 ? (
            <>
              <dt className="text-muted-foreground">Formes non évaluées</dt>
              <dd>
                {notEvaluated.map((s) => `${s.label} : forme non évaluée dans cette version`).join(" ; ")}
                . Aucune mesure de performance n&apos;existe pour elle : elle n&apos;est jamais
                proposée.
              </dd>
            </>
          ) : null}
          {m ? (
            <>
              {m.test_images !== null ? (
                <>
                  <dt className="text-muted-foreground">Images de test</dt>
                  <dd>
                    {formatNumberFr(m.test_images)} images MEB, jamais vues à l&apos;apprentissage
                    ni au choix des réglages
                  </dd>
                </>
              ) : null}
              {m.f1_objects !== null ? (
                <>
                  <dt className="text-muted-foreground">Particules retrouvées (F1)</dt>
                  <dd>{formatNumberFr(m.f1_objects, 2)}</dd>
                </>
              ) : null}
              {m.count_mae !== null ? (
                <>
                  <dt className="text-muted-foreground">Erreur moyenne de comptage</dt>
                  <dd>{formatNumberFr(m.count_mae, 1)} {m.count_mae < 2 ? "particule" : "particules"} par image</dd>
                </>
              ) : null}
              {m.dice !== null ? (
                <>
                  <dt className="text-muted-foreground">Recouvrement des contours (Dice)</dt>
                  <dd>{formatNumberFr(m.dice, 2)}</dd>
                </>
              ) : null}
              {m.shape_balanced_accuracy !== null ? (
                <>
                  <dt className="text-muted-foreground">
                    Exactitude du classifieur de forme sur les contours de référence (pas sur les
                    particules proposées)
                  </dt>
                  <dd>
                    {share(m.shape_balanced_accuracy)} (moyenne par forme : {evaluated.map((s) => s.label).join(", ")}).
                    Chiffre favorable : il ne tient pas compte des erreurs de contour.
                  </dd>
                </>
              ) : null}
              {m.shape_proposed_balanced_accuracy != null && m.shape_proposed_accuracy != null ? (
                <>
                  <dt className="text-muted-foreground">
                    Exactitude de la forme sur les particules proposées
                  </dt>
                  <dd>
                    {share(m.shape_proposed_accuracy)} d&apos;exactitude, {share(m.shape_proposed_balanced_accuracy)} en
                    moyenne par forme
                    {m.shape_proposed_n != null ? ` (${formatNumberFr(m.shape_proposed_n)} particules appariées)` : ""}
                  </dd>
                </>
              ) : null}
              {m.bead_shape_n != null && m.bead_shape_correct != null ? (
                <>
                  <dt className="text-muted-foreground">Billes : point faible connu</dt>
                  <dd>
                    {formatNumberFr(m.bead_shape_correct)} billes sur {formatNumberFr(m.bead_shape_n)} reconnues comme
                    billes
                    {m.bead_feret_rel_err_median != null
                      ? ` ; diamètre de Feret maximal : erreur médiane de ${formatPercentFr(m.bead_feret_rel_err_median)}`
                      : ""}
                    . Les tailles et les formes des billes sont à vérifier une à une.
                  </dd>
                </>
              ) : null}
              {m.unreliable_share !== null ? (
                <>
                  <dt className="text-muted-foreground">Part d&apos;images « non fiables »</dt>
                  <dd>{share(m.unreliable_share)} des images de test</dd>
                </>
              ) : null}
            </>
          ) : null}
          {t ? (
            <>
              <dt className="text-muted-foreground">Seuils</dt>
              <dd>
                forme incertaine sous un score de {formatNumberFr(t.shape_min_score, 2)} ; image non
                fiable si plus de {formatPercentFr(t.max_foreground)} de l&apos;image est segmentée
                ou si le contraste est inférieur à {formatNumberFr(t.min_contrast, 0)} sur 255 (écart entre les
                centiles 1 et 99 des niveaux de gris)
              </dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Données d&apos;entraînement</dt>
          <dd>{info.training_data}</dd>
        </dl>
        <p className="text-sm text-muted-foreground">
          Fiche complète : {info.card_path} (documentation du projet).
        </p>
      </div>
    </Section>
  );
}

export default async function ImagesPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);
  const archived = study.archivedAt !== null;
  const [model, list, counts, consent] = await Promise.all([
    getImageModel(ctx),
    listImageAnalyses(ctx, study.id),
    listValidatedCounts(ctx, study.id),
    getTrainingConsent(ctx),
  ]);
  const writable = canWrite(ctx.role) && !archived;
  const base = `/labo/${labSlug}/etudes/${study.id}/images`;

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
        <Section title="Analyser une image">
          <AnalyzeImageForm labSlug={labSlug} studyId={study.id} />
        </Section>
      ) : null}

      <Section title="Analyses de l'étude">
        {list.rows.length === 0 ? (
          <EmptyState icon={ImageIcon} title="Aucune image analysée dans cette étude." />
        ) : (
          <>
            <Table>
              <TableCaption className="sr-only">Analyses d&apos;images de l&apos;étude</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Fichier</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Particules proposées</TableHead>
                  <TableHead>Échelle</TableHead>
                  <TableHead>Décision</TableHead>
                  <TableHead className="sticky right-0 bg-muted">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((r) => {
                  const decision = imageDecisionBadge(r.decision?.decision ?? null);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <DateTimeFr value={r.createdAt} />
                      </TableCell>
                      <TableCell className="min-w-32 whitespace-normal break-all">
                        {r.fileName}
                      </TableCell>
                      <TableCell className="min-w-28 whitespace-normal">
                        <Badge
                          variant={
                            IMAGE_STATUS_BADGES[r.status as keyof typeof IMAGE_STATUS_BADGES] ??
                            "neutral"
                          }
                        >
                          {r.statusLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">{formatNumberFr(r.count)}</TableCell>
                      <TableCell className="min-w-28 whitespace-normal">
                        {r.scaleSourceLabel}
                      </TableCell>
                      <TableCell className="min-w-24 whitespace-normal">
                        <Badge variant={decision.badge}>{decision.label}</Badge>
                      </TableCell>
                      <TableCell className="sticky right-0 bg-card shadow-[inset_1px_0_0_var(--border)]">
                        <Link
                          href={`${base}/${r.id}`}
                          aria-label={`Ouvrir l'analyse du ${formatDateTimeFr(r.createdAt) ?? ""}`}
                          className={linkClass}
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

      <Section title="Comptage de particules candidates (images validées)">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{COUNTS_SENTENCE}</p>
          {counts.length === 0 ? (
            <p className="text-sm">Aucune image validée dans cette étude.</p>
          ) : (
            <>
              <Table>
                <TableCaption className="sr-only">
                  Comptages de particules candidates des images validées
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date de la décision</TableHead>
                    <TableHead>Décision</TableHead>
                    <TableHead className="text-right">Particules validées</TableHead>
                    <TableHead className="text-right">Fibres</TableHead>
                    <TableHead className="text-right">Fragments</TableHead>
                    <TableHead className="text-right">Billes</TableHead>
                    <TableHead className="text-right">Films</TableHead>
                    <TableHead className="text-right">Forme non renseignée</TableHead>
                    <TableHead>Feret médian</TableHead>
                    <TableHead className="sticky right-0 bg-muted">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {counts.map((c) => {
                    const byShape = (...shapes: string[]) =>
                      c.validated.count_by_shape
                        .filter((s) => shapes.includes(s.shape))
                        .reduce((n, s) => n + s.count, 0);
                    const decision = imageDecisionBadge(c.decision);
                    return (
                      <TableRow key={c.decisionId}>
                        <TableCell>
                          <DateTimeFr value={c.decidedAt} />
                        </TableCell>
                        <TableCell className="min-w-24 whitespace-normal">
                          <Badge variant={decision.badge}>{decision.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumberFr(c.validated.count)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumberFr(byShape("fibre"))}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumberFr(byShape("fragment"))}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumberFr(byShape("bille"))}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumberFr(byShape("film"))}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumberFr(byShape("unspecified", "uncertain"))}
                        </TableCell>
                        <TableCell className="min-w-28 whitespace-normal">
                          {c.medianFeretUm === null
                            ? "échelle inconnue"
                            : `${formatNumberFr(c.medianFeretUm, 1)} µm`}
                        </TableCell>
                        <TableCell className="sticky right-0 bg-card shadow-[inset_1px_0_0_var(--border)]">
                          <Link
                            href={`${base}/${c.analysisId}`}
                            aria-label={`Ouvrir l'analyse validée le ${formatDateTimeFr(c.decidedAt) ?? ""}`}
                            className={linkClass}
                          >
                            Voir
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <a href={`${base}/comptages`} className={linkClass}>
                Télécharger les comptages (CSV)
              </a>
            </>
          )}
        </div>
      </Section>

      {model.kind === "ok" ? <ModelCard info={model.info} /> : null}
    </div>
  );
}
