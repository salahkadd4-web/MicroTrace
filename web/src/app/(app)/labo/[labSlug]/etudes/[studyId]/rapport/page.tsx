import { Button } from "@/components/ui/button";
import { requireLab } from "@/server/lab-context";
import { getReportAvailability } from "@/server/report-download";
import { loadStudy } from "../load-study";

const NOTHING_TO_EXPORT = "Aucun import actif : rien à exporter.";

const CONTENTS = [
  "Le titre, la date et les versions (moteur, règles de contrôle de chaque import).",
  "La nature des données, le DOI et la licence de référence, la correction du blanc, tels qu'ils étaient lors des imports.",
  "Les méthodes et les limites de détection (LOD, LOQ) utilisées pour calculer les statuts.",
  "Les imports actifs : fichier, empreinte SHA-256, date, auteur, nombre d'erreurs, d'avertissements et d'informations.",
  "La règle d'agrégation, les fréquences de quantification et les statistiques par groupe, calculées par le moteur.",
  "Le résumé des contrôles qualité, les avertissements et les limites d'interprétation.",
];

function Download({
  href,
  label,
  enabled,
  describedBy,
}: {
  href: string;
  label: string;
  enabled: boolean;
  describedBy?: string;
}) {
  if (!enabled) {
    return (
      <Button variant="outline" disabled aria-describedby={describedBy}>
        {label}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline">
      <a href={href}>{label}</a>
    </Button>
  );
}

export default async function RapportPage({
  params,
}: {
  params: Promise<{ labSlug: string; studyId: string }>;
}) {
  const { labSlug, studyId } = await params;
  const [study, ctx] = await Promise.all([loadStudy(labSlug, studyId), requireLab(labSlug)]);
  const { hasMeasurements } = await getReportAvailability(ctx, study.id);
  const base = `/labo/${labSlug}/etudes/${study.id}/rapport`;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Contenu du rapport</h2>
        <p className="text-sm text-muted-foreground">
          Le rapport porte sur les imports actifs de l&apos;étude. Il est produit par le moteur
          d&apos;analyse au moment du téléchargement ; rien n&apos;est conservé.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {CONTENTS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-sm font-medium">Prototype de recherche, pas un dispositif médical.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Télécharger</h2>
        {hasMeasurements ? null : (
          <p id="rapport-vide" className="text-sm text-muted-foreground">
            {NOTHING_TO_EXPORT}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Download
            href={`${base}/telecharger?format=html`}
            label="Rapport HTML"
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
          valeurs telles qu&apos;enregistrées, avec le nom du fichier d&apos;import.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Dictionnaire de données</h2>
        <p className="text-sm text-muted-foreground">
          Les champs attendus dans un fichier de mesures, avec leur description.
        </p>
        <div className="flex flex-wrap gap-2">
          <Download href={`${base}/dictionnaire?format=csv`} label="Dictionnaire (CSV)" enabled />
          <Download href={`${base}/dictionnaire?format=md`} label="Dictionnaire (Markdown)" enabled />
        </div>
      </section>
    </div>
  );
}
