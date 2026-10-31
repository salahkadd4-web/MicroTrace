"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatEngineNumberFr } from "@/components/app/NumberFr";

const AXIS = { fill: "var(--muted-foreground)" } as const;
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--popover-foreground)",
} as const;
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export type Curve = { x: number[]; y: number[] };
export type ChartReference = { id: string; name: string; curve: Curve | null };

const points = (c: Curve) => c.x.map((x, i) => ({ x, y: c.y[i] }));

/**
 * Spectre déposé (prétraité) superposé aux seules références dont le moteur renvoie une courbe
 * (licence permissive) ; la fenêtre diagnostique est ombrée. La légende et la table des
 * références sont en HTML, à côté.
 */
export function SpectrumChart({
  query,
  references,
  xLabel,
  yLabel,
  windowMin,
  windowMax,
}: {
  query: Curve;
  references: ChartReference[];
  xLabel: string;
  yLabel: string;
  windowMin: number;
  windowMax: number;
}) {
  const shown = references.filter((r): r is ChartReference & { curve: Curve } => r.curve !== null);
  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label={`Spectre déposé superposé aux spectres de référence affichables (${shown.length})`}
        className="h-80 w-full rounded-lg border bg-card p-4 text-xs"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              domain={["dataMin", "dataMax"]}
              tick={AXIS}
              tickFormatter={(v: number) => formatEngineNumberFr(v)}
              label={{
                value: xLabel,
                position: "insideBottom",
                offset: -12,
                fill: "var(--muted-foreground)",
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              tick={AXIS}
              tickFormatter={(v: number) => formatEngineNumberFr(v)}
              width={56}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v) => formatEngineNumberFr(Number(v))}
              labelFormatter={(v) => `${xLabel} : ${formatEngineNumberFr(Number(v))}`}
            />
            <ReferenceArea x1={windowMin} x2={windowMax} fill="var(--muted)" fillOpacity={0.6} />
            {shown.map((r, i) => (
              <Line
                key={r.id}
                name={r.name}
                data={points(r.curve)}
                dataKey="y"
                type="monotone"
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            ))}
            <Line
              name="Spectre déposé"
              data={points(query)}
              dataKey="y"
              type="monotone"
              stroke="var(--foreground)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">Axe vertical : {yLabel}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Légende du graphique">
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-5"
            style={{ background: "var(--foreground)" }}
          />
          Spectre déposé
        </li>
        {shown.map((r, i) => (
          <li key={r.id} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-5"
              style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
            />
            {r.name}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-sm"
            style={{ background: "var(--muted)" }}
          />
          Fenêtre diagnostique
        </li>
      </ul>
    </div>
  );
}
