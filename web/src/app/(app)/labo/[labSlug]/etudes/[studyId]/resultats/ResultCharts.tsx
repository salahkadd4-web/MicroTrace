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
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--popover-foreground)",
} as const;
const CURSOR = { fill: "var(--muted)" } as const;
/** Au-delà de 6 polymères, les libellés de l'axe x sont inclinés pour rester lisibles. */
const crowdedAxis = (n: number) =>
  n > 6 ? ({ interval: 0, angle: -30, textAnchor: "end", height: 56 } as const) : {};
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
    <div role="img" aria-label={ariaLabel} className="h-64 w-full rounded-lg border bg-card p-4 text-xs">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} {...crowdedAxis(bars.length)} />
          <YAxis
            domain={[0, 1]}
            tick={AXIS}
            tickFormatter={(v: number) => formatPercentFr(v)}
            width={56}
          />
          <Tooltip
            formatter={(v) => formatPercentFr(Number(v))}
            contentStyle={TOOLTIP_STYLE}
            cursor={CURSOR}
          />
          <Bar
            dataKey="fraction"
            name="Fréquence"
            fill="var(--chart-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
          />
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
    <div role="img" aria-label={ariaLabel} className="h-72 w-full rounded-lg border bg-card p-4 text-xs">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="polymerIndex"
            domain={[-0.5, Math.max(polymers.length - 0.5, 0.5)]}
            ticks={polymers.map((_, i) => i)}
            tickFormatter={(i: number) => polymers[i] ?? ""}
            tick={AXIS}
            allowDecimals={false}
            {...crowdedAxis(polymers.length)}
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
            cursor={{ strokeDasharray: "3 3", stroke: "var(--border)" }}
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as SamplePoint | undefined) : undefined;
              if (!point) return null;
              return (
                <div style={TOOLTIP_STYLE} className="space-y-0.5 px-3 py-2 text-xs shadow-md">
                  <p className="font-medium">{polymers[point.polymerIndex] ?? ""}</p>
                  <p>{point.sampleId}</p>
                  <p className="tabular-nums">
                    {formatEngineNumberFr(point.value)} {unit}
                  </p>
                </div>
              );
            }}
          />
          {polymers.map((p, i) => (
            <Scatter
              key={p}
              name={p}
              data={points.filter((pt) => pt.polymerIndex === i)}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              fillOpacity={0.75}
              {...(i % SERIES_COLORS.length >= 3
                ? { stroke: "var(--foreground)", strokeOpacity: 0.35 }
                : {})}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
