import { Badge } from "@/components/ui/badge";

export type DataNature = "published" | "laboratory" | "simulated";

const LABELS: Record<DataNature, string> = {
  published: "Données publiées",
  laboratory: "Données de laboratoire",
  simulated: "SIMULÉ — données fictives",
};

export function DataNatureBanner({ nature }: { nature: DataNature }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm"
      data-nature={nature}
    >
      <Badge variant={nature === "simulated" ? "destructive" : "secondary"}>
        {LABELS[nature]}
      </Badge>
      <span className="text-muted-foreground">
        Prototype de recherche, pas un dispositif médical
      </span>
    </div>
  );
}
