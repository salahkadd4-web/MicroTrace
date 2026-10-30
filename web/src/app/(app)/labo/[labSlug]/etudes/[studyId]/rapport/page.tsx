import { Download as DownloadIcon } from "lucide-react";
import { Section } from "@/components/app/Section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DOWNLOAD_ERRORS, NOTHING_TO_EXPORT } from "@/lib/engine-messages";
import { requireLab } from "@/server/lab-context";
import { getReportAvailability } from "@/server/report-download";
import { loadStudy } from "../load-study";

const CONTENTS = [
  "Le titre, la date et les versions (moteur, règles de contrôle de chaque import).",
  "La nature des données, le DOI et la licence de référence, la correction du blanc, tels qu'ils sont dans les paramètres de l'étude (une étude simulée est signalée SIMULÉ).",
  "Les méthodes et les limites de détection (LOD, LOQ) utilisées pour calculer les statuts, telles qu'elles étaient lors des imports.",
  "Les imports actifs : fichier, empreinte SHA-256, date, auteur, nombre d'erreurs, d'avertissements et d'informations.",
  "La règle d'agrégation, les fréquences de quantification et les statistiques par groupe, calculées par le moteur.",
  "Le résumé des contrôles qualité, les avertissements et les limites d'interprétation.",
];

function Download({
  href,
  label,
  enabled,
  describedBy,
  primary,
}: {
  href: string;
  label: string;
  enabled: boolean;
  describedBy?: string;
  primary?: boolean;
}) {
  const variant = primary ? "default" : "outline";
  const content = (
    <>
      <DownloadIcon aria-hidden="true" />
      {label}
    </>
  );
  if (!enabled) {
    return (
      <Button variant={variant} disabled aria-describedby={describedBy}>
        {content}
      </Button>
    );
  }
  return (
    <Button asChild variant={variant}>
      <a href={href}>{content}</a>
    </Button>
  );
}

export default async function RapportPage({
  params,
  searchParams,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
  searchParams?: Promise<{ erreur?: string | string[] }>;
}) {
  const { labSlug, studyId } = await params;
  const erreur = (await searchParams)?.erreur;
  const failure = typeof erreur === "string" && Object.hasOwn(DOWNLOAD_ERRORS, erreur)
      ? DOWNLOAD_ERRORS[erreur]
      : undefined;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);
  const { hasMeasurements } = await getReportAvailability(ctx, study.id);
  const base = `/labo/${labSlug}/etudes/${study.id}/rapport`;

  return (
    <div className="space-y-6">
      <Section
        title="Contenu du rapport"
        description="Le rapport porte sur les imports actifs de l'étude. Il est produit par le moteur d'analyse au moment du téléchargement ; rien n'est conservé."
      >
        <ul className="list-disc space-y-1 pl-5 text-sm marker:text-primary">
          {CONTENTS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-sm font-medium">Prototype de recherche, pas un dispositif médical.</p>
      </Section>

      <Section title="Télécharger">
        {failure ? (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        {hasMeasurements ? null : (
          <p id="rapport-vide" className="text-sm text-muted-foreground">
            {NOTHING_TO_EXPORT}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Download
            href={`${base}/telecharger?format=html`}
            label="Rapport HTML"
            primary
            enabled={hasMeasurements}
            describedBy="rapport-vide"
          />
          <Download
            href={`${base}/telecharger?format=md`}
            label="Rapport Markdown"
            enabled={hasMeasurements}
            describedBy="rapport-vide"
          />
          <Download
            href={`${base}/telecharger?format=csv`}
            label="Mesures actives (CSV)"
            enabled={hasMeasurements}
            describedBy="rapport-vide"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Le CSV des mesures actives utilise le point-virgule comme séparateur et contient les
          valeurs telles qu&apos;enregistrées, avec la nature des données de l&apos;étude et le nom du fichier d&apos;import. Le nom d&apos;un fichier d&apos;étude simulée commence par SIMULE-.
        </p>
      </Section>

      <Section
        title="Dictionnaire de données"
        description="Les champs attendus dans un fichier de mesures, avec leur description."
      >
        <div className="flex flex-wrap gap-2">
          <Download href={`${base}/dictionnaire?format=csv`} label="Dictionnaire (CSV)" enabled />
          <Download href={`${base}/dictionnaire?format=md`} label="Dictionnaire (Markdown)" enabled />
        </div>
      </Section>
    </div>
  );
}
