import { notFound } from "next/navigation";
import Link from "next/link";
import { DateTimeFr, formatDateTimeFr } from "@/components/app/DateTimeFr";
import { formatEngineNumberFr, formatNumberFr } from "@/components/app/NumberFr";
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
import { canWrite } from "@/lib/roles";
import { SPECTRAL_STATUS_BADGES, spectralDecisionBadge } from "@/lib/spectral";
import { requireLab } from "@/server/lab-context";
import { getSpectralAnalysis, getSpectralModel } from "@/server/spectral";
import { loadStudy } from "../../load-study";
import { DecisionForm } from "./DecisionForm";
import { SpectrumChart } from "./SpectrumChart";

/** Au plus ce nombre de points est listé dans « Voir les données ». */
const MAX_TABLE_ROWS = 500;

const short = (sha: string) => (sha.length > 12 ? `${sha.slice(0, 12)}…` : sha);

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${formatNumberFr(bytes / 1024, 1)} Ko`
    : `${formatNumberFr(bytes / (1024 * 1024), 1)} Mo`;
}

export default async function SpectrumAnalysisPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string; analysisId: string }>;
}) {
  const { labSlug, studyId, analysisId } = await params;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);
  const [analysis, model] = await Promise.all([
    getSpectralAnalysis(ctx, study.id, analysisId),
    getSpectralModel(ctx),
  ]);
  if (!analysis) notFound();

  const out = analysis.output;
  const abstained = out.status === "not_identified";
  const canDecide = canWrite(ctx.role) && !analysis.archived;
  const currentVersion = model.kind === "engine_down" ? null : model.info.version;
  const decision = analysis.decision;
  const decisionBadge = spectralDecisionBadge(decision?.decision ?? null);
  const base = `/labo/${labSlug}/etudes/${study.id}/spectres`;
  const displayed = out.references.filter((r) => r.curve !== null);
  const plotted = [
    { name: "Spectre déposé", curve: out.query_curve },
    ...displayed.map((r) => ({ name: `${r.library_name} ${r.spectrum_id}`, curve: r.curve! })),
  ].flatMap(({ name, curve }) => curve.x.map((x, i) => ({ name, x, y: curve.y[i] })));
  const cited = [...new Map(out.references.map((r) => [r.library, r])).values()];

  return (
    <div className="space-y-6">
      {currentVersion !== null && currentVersion !== analysis.modelVersion ? (
        <Alert variant="info">
          <AlertDescription>
            Analyse faite avec la version {analysis.modelVersion} du modèle ; version actuelle :{" "}
            {currentVersion}.
          </AlertDescription>
        </Alert>
      ) : null}
      {analysis.archived ? (
        <Alert variant="info">
          <AlertDescription>
            Étude archivée : les analyses et décisions sont en lecture seule.
          </AlertDescription>
        </Alert>
      ) : null}

      <Section title={`Analyse du ${formatDateTimeFr(analysis.createdAt) ?? ""}`}>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Fichier</dt>
          <dd className="break-all">{analysis.fileName}</dd>
          <dt className="text-muted-foreground">Taille</dt>
          <dd>{formatSize(analysis.sizeBytes)}</dd>
          <dt className="text-muted-foreground">Empreinte sha256</dt>
          <dd title={analysis.inputSha256} className="font-mono text-xs">
            {short(analysis.inputSha256)}
          </dd>
          <dt className="text-muted-foreground">Technique</dt>
          <dd>{out.input.technique_label}</dd>
          <dt className="text-muted-foreground">Axe</dt>
          <dd>{out.x_label}</dd>
          <dt className="text-muted-foreground">Ordonnée</dt>
          <dd>{out.y_label}</dd>
          {analysis.laserNm !== null ? (
            <>
              <dt className="text-muted-foreground">Laser</dt>
              <dd>{formatNumberFr(analysis.laserNm)} nm</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Fenêtre diagnostique</dt>
          <dd>
            {formatNumberFr(out.input.window_min)} à {formatNumberFr(out.input.window_max)} cm⁻¹,
            couverte à {formatNumberFr(out.input.diagnostic_coverage * 100, 0)} %
          </dd>
          <dt className="text-muted-foreground">Modèle</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span>
              {analysis.modelName}, version {analysis.modelVersion}
              {analysis.modelSha256 ? (
                <>
                  {" "}
                  (<span title={analysis.modelSha256} className="font-mono text-xs">
                    {short(analysis.modelSha256)}
                  </span>
                  )
                </>
              ) : null}
            </span>
            <Badge variant="outline">{out.trial_label}</Badge>
          </dd>
        </dl>
      </Section>

      <Section title="Proposition">
        <div className="space-y-3">
          <Badge
            variant={SPECTRAL_STATUS_BADGES[out.status] ?? "neutral"}
          >
            {out.status_label}
          </Badge>
          <p className="text-sm">{out.explanation}</p>
          {out.candidates.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-base font-medium">
                {abstained ? "Polymères les plus proches (à titre indicatif)" : "Polymères proposés"}
              </h3>
              <Table>
                <TableCaption className="sr-only">
                  {abstained ? "Polymères les plus proches (à titre indicatif)" : "Polymères proposés"}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rang</TableHead>
                    <TableHead>Polymère</TableHead>
                    <TableHead>Corrélation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {out.candidates.map((c) => (
                    <TableRow key={c.rank}>
                      <TableCell>{c.rank}</TableCell>
                      <TableCell>{c.label}</TableCell>
                      <TableCell className="tabular-nums">{c.score_text}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          {out.classifier_label ? (
            <p className="text-sm">Avis du classifieur PCA+SVM : {out.classifier_label}</p>
          ) : null}
        </div>
      </Section>

      <Section title="Spectre et références">
        <div className="space-y-4">
          <div className="space-y-3">
            <h3 className="text-base font-medium">Spectre déposé et références</h3>
            <p className="text-sm text-muted-foreground">
              Spectre déposé (trait épais), prétraité par le moteur et tracé tel qu&apos;il le
              renvoie, superposé aux spectres de référence dont la licence permet d&apos;afficher
              la courbe ({displayed.length} sur {out.references.length}). Axe horizontal :{" "}
              {out.x_label} ; axe vertical : {out.y_label}. La fenêtre diagnostique est ombrée.
            </p>
            <SpectrumChart
              query={out.query_curve}
              references={out.references.map((r) => ({
                id: r.spectrum_id,
                name: `${r.library_name} ${r.spectrum_id}`,
                curve: r.curve,
              }))}
              xLabel={out.x_label}
              yLabel={out.y_label}
              windowMin={out.input.window_min}
              windowMax={out.input.window_max}
            />
            <details>
              <summary className="cursor-pointer text-sm font-medium text-primary">
                Voir les données
              </summary>
              <Table>
                <TableCaption className="sr-only">Points tracés du graphique</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Courbe</TableHead>
                    <TableHead className="text-right">{out.x_label}</TableHead>
                    <TableHead className="text-right">{out.y_label}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plotted.slice(0, MAX_TABLE_ROWS).map((p, i) => (
                    <TableRow key={i}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatEngineNumberFr(p.x)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatEngineNumberFr(p.y)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {plotted.length > MAX_TABLE_ROWS ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {MAX_TABLE_ROWS} premières lignes sur {formatEngineNumberFr(plotted.length)}.
                </p>
              ) : null}
            </details>
          </div>
          <Table>
            <TableCaption className="sr-only">Spectres de référence les plus proches</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Rang</TableHead>
                <TableHead>Bibliothèque</TableHead>
                <TableHead>Identifiant</TableHead>
                <TableHead>Polymère</TableHead>
                <TableHead>Corrélation</TableHead>
                <TableHead>Licence</TableHead>
                <TableHead>Courbe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {out.references.map((r) => (
                <TableRow key={`${r.library}-${r.spectrum_id}`}>
                  <TableCell>{r.rank}</TableCell>
                  <TableCell>{r.library_name}</TableCell>
                  <TableCell className="break-all">{r.spectrum_id}</TableCell>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="tabular-nums">{r.score_text}</TableCell>
                  <TableCell>{r.licence_text}</TableCell>
                  <TableCell>{r.curve ? "affichée" : (r.curve_note ?? "non affichée")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {cited.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {cited.map((r) => (
                <li key={r.library}>
                  {r.library_name} : {r.citation}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Section>

      <Section title="Décision">
        <div className="space-y-4">
          {decision ? (
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant={decisionBadge.badge}>{decisionBadge.label}</Badge>
                {decision.polymer ? (
                  <span>Polymère retenu : {decision.polymerLabel ?? decision.polymer}</span>
                ) : null}
              </p>
              {decision.note ? <p className="whitespace-pre-line">{decision.note}</p> : null}
              <p className="text-muted-foreground">
                par {decision.decidedBy ?? "—"}, le <DateTimeFr value={decision.decidedAt} />
                {decision.count > 1 ? ` (${decision.count} décisions, voir le Journal)` : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm">
              <Badge variant="outline">Non examinée</Badge>
            </p>
          )}
          {canDecide ? (
            <DecisionForm
              labSlug={labSlug}
              studyId={study.id}
              analysisId={analysis.id}
              notIdentified={abstained}
              vocabulary={out.correction_vocabulary}
            />
          ) : null}
        </div>
      </Section>

      <Link
        href={base}
        className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Toutes les analyses
      </Link>
    </div>
  );
}
