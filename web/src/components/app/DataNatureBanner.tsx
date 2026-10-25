import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DataNature = "published" | "laboratory" | "simulated";

const LABELS: Record<DataNature, string> = {
  published: "Données publiées",
  laboratory: "Données de laboratoire",
  simulated: "SIMULÉ — données fictives",
};

export function DataNatureBanner({ nature }: { nature: DataNature }) {
  const simulated = nature === "simulated";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        simulated ? "border-warning bg-warning text-warning-foreground" : "bg-muted",
      )}
      data-nature={nature}
    >
      {simulated ? (
        <strong className="font-bold uppercase tracking-wide">{LABELS[nature]}</strong>
      ) : (
        <Badge variant="secondary">{LABELS[nature]}</Badge>
      )}
      <span className={simulated ? undefined : "text-muted-foreground"}>
        Prototype de recherche, pas un dispositif médical
      </span>
    </div>
  );
}
