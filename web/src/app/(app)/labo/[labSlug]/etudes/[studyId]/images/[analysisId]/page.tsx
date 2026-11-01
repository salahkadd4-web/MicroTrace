import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTimeFr, formatDateTimeFr } from "@/components/app/DateTimeFr";
import { formatNumberFr } from "@/components/app/NumberFr";
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
import { CORRECTION_OPTIONS, IMAGE_STATUS_BADGES, imageDecisionBadge } from "@/lib/images";
import { canWrite } from "@/lib/roles";
import { getImageAnalysis, getImageModel } from "@/server/images";
import { requireLab } from "@/server/lab-context";
import { loadStudy } from "../../load-study";
import { ImageDecisionForm } from "./ImageDecisionForm";
import { ParticleOverlay } from "./ParticleOverlay";
import { SizeHistogram } from "./SizeHistogram";
import { particuleCandidates } from "@/lib/images";

/** Au plus ce nombre de particules est listé (le moteur n'en renvoie pas davantage). */
const MAX_TABLE_ROWS = 300;

const short = (sha: string) => (sha.length > 12 ? `${sha.slice(0, 12)}…` : sha);
const linkClass = "text-sm font-medium text-primary underline-offset-4 hover:underline";

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${formatNumberFr(bytes / 1024, 1)} Ko`
    : `${formatNumberFr(bytes / (1024 * 1024), 1)} Mo`;
}

const COLOR_LABELS: Record<string, string> = {
  gray: "niveaux de gris",
  rgb: "couleur (RVB)",
  cmyk: "couleur (CMJN, convertie)",
  palette: "palette (convertie)",
};

export default async function ImageAnalysisPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string; analysisId: string }>;
}) {
  const { labSlug, studyId, analysisId } = await params;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);
  const [analysis, model] = await Promise.all([
    getImageAnalysis(ctx, study.id, analysisId),
    getImageModel(ctx),
  ]);
  if (!analysis) notFound();

  const out = analysis.output;
  const unreliable = out.status === "unreliable";
  const canDecide = canWrite(ctx.role) && !analysis.archived;
  const currentVersion = model.kind === "engine_down" ? null : model.info.version;
  const expectedSha = model.kind === "engine_down" ? null : (model.info.expected_sha256 ?? null);
  const sameVersionOtherWeights =
    currentVersion === analysis.modelVersion &&
    expectedSha !== null &&
    analysis.modelSha256 !== null &&
    expectedSha.toLowerCase() !== analysis.modelSha256.toLowerCase();
  const decision = analysis.decision;
  const excludedIds = new Set(decision?.excluded ?? []);
  const reshapedTo = new Map((decision?.reshaped ?? []).map((r) => [r.id, r.shape]));
  const decisionOf = (id: number): string => {
    if (!decision || decision.decision === "rejected") return "—";
    if (excludedIds.has(id)) return "Exclue";
    const shape = reshapedTo.get(id);
    if (shape) {
      const label = CORRECTION_OPTIONS.find((o) => o.code === shape)?.label ?? shape;
      return `Forme corrigée : ${label}`;
    }
    return "Gardée";
  };
  const decisionBadge = imageDecisionBadge(decision?.decision ?? null);
  const base = `/labo/${labSlug}/etudes/${study.id}/images`;
  const here = `${base}/${analysis.id}`;
  const scale = out.scale;
  const inPx = scale === null;
  const unit = inPx ? "px" : "µm";
  const input = out.input;

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
      {sameVersionOtherWeights ? (
        <Alert variant="info">
          <AlertDescription>
            Analyse faite avec d&apos;autres poids que ceux de la version {analysis.modelVersion}{" "}
            actuelle (empreinte différente).
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
          <dt className="text-muted-foreground">Format</dt>
          <dd>
            {input.format}, {formatNumberFr(input.width)} × {formatNumberFr(input.height)} px
          </dd>
          <dt className="text-muted-foreground">Profondeur et couleur</dt>
          <dd>
            {formatNumberFr(input.bit_depth)} bits, {COLOR_LABELS[input.color] ?? input.color}
          </dd>
          <dt className="text-muted-foreground">Orientation appliquée</dt>
          <dd>{input.orientation_applied ? "oui" : "non"}</dd>
          <dt className="text-muted-foreground">Canal alpha ignoré</dt>
          <dd>{input.alpha_ignored ? "oui" : "non"}</dd>
          <dt className="text-muted-foreground">Bandeau du bas retiré</dt>
          <dd>
            {input.cropped_bottom_px > 0 ? `${formatNumberFr(input.cropped_bottom_px)} px` : "non"}
          </dd>
          <dt className="text-muted-foreground">Image d&apos;analyse</dt>
          <dd>
            {formatNumberFr(input.analysis_width)} × {formatNumberFr(input.analysis_height)} px
            {input.downscale !== 1 ? ` (réduite, facteur ${formatNumberFr(input.downscale, 2)})` : ""}
          </dd>
          <dt className="text-muted-foreground">Échelle</dt>
          <dd>
            {scale
              ? `${formatNumberFr(scale.um_per_px_input)} µm/px (${scale.source_label})`
              : "inconnue"}
          </dd>
          {scale ? (
            <>
              <dt className="text-muted-foreground">Taille minimale comptée</dt>
              <dd>{formatNumberFr(scale.min_detectable_um, 1)} µm</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Modèle</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span>
              {analysis.modelName}, version {analysis.modelVersion}
              {analysis.modelSha256 ? (
                <>
                  {" "}
                  (
                  <span title={analysis.modelSha256} className="font-mono text-xs">
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
          <Badge variant={IMAGE_STATUS_BADGES[out.status] ?? "neutral"}>{out.status_label}</Badge>
          <p className="text-sm">{out.explanation}</p>
          {unreliable && out.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {out.reasons.map((r) => (
                <li key={r.code}>{r.label}</li>
              ))}
            </ul>
          ) : null}
          <Table>
            <TableCaption className="sr-only">Particules candidates par forme proposée</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Forme</TableHead>
                <TableHead className="text-right">Particules</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {out.count_by_shape.map((s) => (
                <TableRow key={s.shape}>
                  <TableCell>{s.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumberFr(s.count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Image et contours">
        <div className="space-y-3">
          <ParticleOverlay
            src={`${here}/image`}
            width={input.analysis_width}
            height={input.analysis_height}
            particles={out.particles.map((p) => ({ id: p.id, shape: p.shape, contour: p.contour }))}
          />
          <p className="flex flex-wrap gap-x-6 gap-y-1">
            <a href={`${here}/annotee`} className={linkClass}>
              Télécharger l&apos;image annotée (PNG)
            </a>
            <a href={`${here}/particules`} className={linkClass}>
              Télécharger les particules (CSV)
            </a>
          </p>
        </div>
      </Section>

      <Section title="Particules candidates">
        {out.particles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune particule candidate détectée.</p>
        ) : (
          <div className="space-y-2">
            <Table>
              <TableCaption className="sr-only">
                Particules candidates ({inPx ? "tailles en pixels" : "tailles en micromètres"})
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>N°</TableHead>
                  <TableHead>Forme</TableHead>
                  <TableHead className="text-right">Feret max ({unit})</TableHead>
                  <TableHead className="text-right">Feret min ({unit})</TableHead>
                  <TableHead className="text-right">Aire ({unit}²)</TableHead>
                  <TableHead className="text-right">Diamètre équivalent ({unit})</TableHead>
                  <TableHead>Bord</TableHead>
                  <TableHead>Décision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {out.particles.slice(0, MAX_TABLE_ROWS).map((p) => {
                  const num = (um: number | null, px: number | null) => {
                    const v = inPx ? px : um;
                    return v === null ? "—" : formatNumberFr(v, inPx ? 0 : 1);
                  };
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="tabular-nums">{p.id}</TableCell>
                      <TableCell className="min-w-36 whitespace-normal">
                        <Badge variant={p.shape_status === "uncertain" ? "outline" : "neutral"}>
                          {p.shape_label}
                        </Badge>{" "}
                        <span className="text-xs text-muted-foreground">
                          {p.shape_status === "uncertain" ? "incertaine, " : ""}score{" "}
                          {p.shape_score_text}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(p.feret_max_um, p.feret_max_px)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(p.feret_min_um, p.feret_min_px)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(p.area_um2, p.area_px)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(p.eq_diameter_um, null)}
                      </TableCell>
                      <TableCell className="min-w-20 whitespace-normal">
                        {p.touches_border ? "tronquée" : "—"}
                      </TableCell>
                      <TableCell className="min-w-28 whitespace-normal">{decisionOf(p.id)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {out.particles.length > MAX_TABLE_ROWS ? (
              <p className="text-sm text-muted-foreground">
                {formatNumberFr(out.particles.length - MAX_TABLE_ROWS)}{" "}
                {out.particles.length - MAX_TABLE_ROWS < 2 ? "autre particule non affichée" : "autres particules non affichées"}
                {" "}(le CSV les contient toutes).
              </p>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Distribution des tailles">
        <SizeHistogram distribution={out.size_distribution} total={out.count} />
      </Section>

      <Section title="Décision">
        <div className="space-y-4">
          {decision ? (
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant={decisionBadge.badge}>{decisionBadge.label}</Badge>
                {decision.validated ? (
                  <span>
                    {formatNumberFr(decision.validated.count)} {particuleCandidates(decision.validated.count)}{" "}
                    {decision.validated.count < 2 ? "validée" : "validées"}
                  </span>
                ) : null}
              </p>
              {decision.validated ? <p>{decision.validated.sentence}</p> : null}
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
            <ImageDecisionForm
              labSlug={labSlug}
              studyId={study.id}
              analysisId={analysis.id}
              unreliable={unreliable}
              particles={out.particles.map((p) => ({ id: p.id, shapeLabel: p.shape_label }))}
              previous={
                decision && decision.decision === "corrected"
                  ? { excluded: decision.excluded, reshaped: decision.reshaped, missed: decision.missed }
                  : null
              }
            />
          ) : null}
        </div>
      </Section>

      <Link href={base} className={`inline-block ${linkClass}`}>
        Toutes les analyses
      </Link>
    </div>
  );
}
