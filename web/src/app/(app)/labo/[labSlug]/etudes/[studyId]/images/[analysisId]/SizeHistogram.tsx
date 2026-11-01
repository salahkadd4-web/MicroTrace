"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumberFr } from "@/components/app/NumberFr";
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

const AXIS = { fill: "var(--muted-foreground)" } as const;
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--popover-foreground)",
} as const;

export type SizeBin = { label: string; count: number };
export type SizeDistributionView = {
  bins: SizeBin[];
  median_um: number | null;
  p10_um: number | null;
  p90_um: number | null;
};

const um = (v: number) => `${formatNumberFr(v, 1)} µm`;

/** Distribution des diamètres de Feret maximaux, calculée par le moteur ; sans échelle, pas de graphique. */
export function SizeHistogram({
  distribution,
  total,
}: {
  distribution: SizeDistributionView | null;
  total: number;
}) {
  if (!distribution) {
    return (
      <Alert variant="info">
        <AlertDescription>Échelle inconnue : pas de distribution en µm.</AlertDescription>
      </Alert>
    );
  }
  const filled = distribution.bins.filter((b) => b.count > 0).length;
  return (
    <div className="space-y-3">
      <h3 className="text-base font-medium">Diamètre de Feret maximal des particules</h3>
      <p className="text-sm text-muted-foreground">
        Nombre de particules candidates par classe de diamètre de Feret maximal (en µm),{" "}
        {formatNumberFr(total)} particules au total
        {distribution.median_um !== null
          ? `, médiane ${um(distribution.median_um)}${
              distribution.p10_um !== null && distribution.p90_um !== null
                ? ` (10e centile ${um(distribution.p10_um)}, 90e centile ${um(distribution.p90_um)})`
                : ""
            }`
          : ""}
        . {formatNumberFr(filled)} classes sur {formatNumberFr(distribution.bins.length)} ne sont
        pas vides.
      </p>
      <div
        role="img"
        aria-label={`Distribution des tailles : ${filled} classes non vides`}
        className="h-72 w-full rounded-lg border bg-card p-4 text-xs"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={distribution.bins} margin={{ top: 8, right: 8, bottom: 40, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS}
              interval={0}
              angle={-30}
              textAnchor="end"
              label={{
                value: "Diamètre de Feret maximal (µm)",
                position: "insideBottom",
                offset: -34,
                fill: "var(--muted-foreground)",
              }}
            />
            <YAxis allowDecimals={false} tick={AXIS} width={40} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v) => formatNumberFr(Number(v))}
              cursor={{ fill: "var(--muted)" }}
            />
            <Bar dataKey="count" name="Particules" fill="var(--chart-1)" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-primary">
          Voir les données
        </summary>
        <Table>
          <TableCaption className="sr-only">Particules par classe de taille</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Classe de diamètre de Feret maximal</TableHead>
              <TableHead className="text-right">Particules</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {distribution.bins.map((b) => (
              <TableRow key={b.label}>
                <TableCell>{b.label}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumberFr(b.count)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </div>
  );
}
