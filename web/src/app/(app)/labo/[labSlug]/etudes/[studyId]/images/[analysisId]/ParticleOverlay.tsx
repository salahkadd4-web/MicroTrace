export type OverlayParticle = { id: number; shape: string; contour: number[][] };

/** Couleur de trait par forme ; « incertaine » (et non renseignée) en jeton neutre, pointillé. */
const STROKES: Record<string, string> = {
  fibre: "var(--chart-1)",
  fragment: "var(--chart-2)",
  bille: "var(--chart-3)",
  film: "var(--chart-4)",
};
const NEUTRAL = "var(--muted-foreground)";
const DASH = "6 4";

const LEGEND = [
  { label: "Fibre", stroke: STROKES.fibre, dashed: false },
  { label: "Fragment", stroke: STROKES.fragment, dashed: false },
  { label: "Bille", stroke: STROKES.bille, dashed: false },
  { label: "Forme incertaine", stroke: NEUTRAL, dashed: true },
] as const;

function center(contour: number[][]): [number, number] {
  if (contour.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of contour) {
    sx += x;
    sy += y;
  }
  return [sx / contour.length, sy / contour.length];
}

/**
 * Image d'analyse (PNG sans métadonnée, réécrit par le moteur) avec le contour de chaque particule
 * candidate en calque SVG : le repère du calque est celui des pixels de l'image d'analyse.
 */
export function ParticleOverlay({
  src,
  width,
  height,
  particles,
}: {
  src: string;
  width: number;
  height: number;
  particles: readonly OverlayParticle[];
}) {
  const fontSize = Math.max(10, Math.round(width / 70));
  return (
    <div className="space-y-3">
      <figure className="relative w-full overflow-hidden rounded-lg border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- image du magasin, servie par une route authentifiée */}
        <img src={src} alt="" width={width} height={height} className="h-auto w-full" />
        <svg
          role="img"
          aria-label={`Image analysée : ${particles.length} particules candidates délimitées`}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {particles.map((p) => (
            <polygon
              key={p.id}
              points={p.contour.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke={STROKES[p.shape] ?? NEUTRAL}
              strokeWidth={2}
              strokeDasharray={p.shape in STROKES ? undefined : DASH}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {particles.map((p) => {
            const [x, y] = center(p.contour);
            return (
              <text
                key={p.id}
                x={x}
                y={y}
                fontSize={fontSize}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--foreground)"
                stroke="var(--background)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {p.id}
              </text>
            );
          })}
        </svg>
      </figure>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Légende des contours">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0 w-5 border-t-2"
              style={{ borderTopColor: l.stroke, borderTopStyle: l.dashed ? "dashed" : "solid" }}
            />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
