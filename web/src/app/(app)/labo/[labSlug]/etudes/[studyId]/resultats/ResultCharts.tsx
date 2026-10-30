"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatEngineNumberFr, formatPercentFr } from "@/components/app/NumberFr";

const AXIS = { fill: "var(--muted-foreground)" } as const;
const GRID = "var(--border)";
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export type FrequencyBar = { label: string; fraction: number };

/** Barres : fréquence de quantification (valeur du moteur) par polymère. Le tableau équivalent suit. */
export function FrequencyChart({ bars, ariaLabel }: { bars: FrequencyBar[]; ariaLabel: string }) {
  return (
    <div role="img" aria-label={ariaLabel} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} />
          <YAxis
            domain={[0, 1]}
            tick={AXIS}
            tickFormatter={(v: number) => formatPercentFr(v)}
            width={56}
          />
          <Tooltip formatter={(v) => formatPercentFr(Number(v))} />
          <Bar dataKey="fraction" name="Fréquence" fill="var(--chart-1)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export type SamplePoint = { sampleId: string; polymerIndex: number; value: number };

/**
 * Points : un point par échantillon quantifié, axe vertical dans l'unité canonique du groupe.
 * Seuls les échantillons quantifiés sont transmis ; les autres statuts ne sont jamais tracés.
 */
export function SamplePointsChart({
  polymers,
  points,
  unit,
  ariaLabel,
}: {
  polymers: string[];
  points: SamplePoint[];
  unit: string;
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel} className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis
            type="number"
            dataKey="polymerIndex"
            domain={[-0.5, Math.max(polymers.length - 0.5, 0.5)]}
            ticks={polymers.map((_, i) => i)}
            tickFormatter={(i: number) => polymers[i] ?? ""}
            tick={AXIS}
            allowDecimals={false}
          />
          <YAxis
            type="number"
            dataKey="value"
            tick={AXIS}
            tickFormatter={(v: number) => formatEngineNumberFr(v)}
            unit={` ${unit}`}
            width={96}
          />
          <Tooltip
            formatter={(v, name) =>
              name === "value" ? `${formatEngineNumberFr(Number(v))} ${unit}` : String(v)
            }
          />
          {polymers.map((p, i) => (
            <Scatter
              key={p}
              name={p}
              data={points.filter((pt) => pt.polymerIndex === i)}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
