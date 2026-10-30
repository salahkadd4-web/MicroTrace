import { cn } from "@/lib/utils";

type LogoProps = {
  /** `full` = goutte + « MicroTrace » + « Studio ». */
  variant?: "mark" | "full";
  /** `light` = sur fond clair (défaut) ; `dark` = sur fond sombre. */
  tone?: "light" | "dark";
  /** Hauteur de la goutte en px. */
  size?: number;
  className?: string;
};

const TONES = {
  light: { outline: "var(--brand-ink)", trace: "var(--brand-coral)", shard: "var(--brand-teal)" },
  dark: {
    outline: "var(--brand-ground)",
    trace: "var(--brand-coral-bright)",
    shard: "var(--brand-teal-bright)",
  },
} as const;

/** « Goutte tracée » : contour de goutte, trace de signal, éclats de particules. Couleurs par jetons. */
export function Logo({ variant = "mark", tone = "light", size = 28, className }: LogoProps) {
  const colours = TONES[tone];
  const small = size < 24;
  const mark = (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path
        d="M60 10 C60 10 22 54 22 78 A38 38 0 0 0 98 78 C98 54 60 10 60 10 Z"
        fill="none"
        stroke={colours.outline}
        strokeWidth={small ? 8 : 6}
        strokeLinejoin="round"
      />
      <polyline
        points="30,82 44,82 50,68 57,94 64,56 71,82 90,82"
        fill="none"
        stroke={colours.trace}
        strokeWidth={small ? 6.5 : 5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon points="45,50 52,47 54,54 47,57" fill={colours.shard} />
      {small ? null : (
        <>
          <polygon points="71,98 78,95 79,102" fill={colours.shard} />
          <polygon points="76,60 81,62 78,66" fill={colours.shard} />
        </>
      )}
    </svg>
  );
  if (variant === "mark") return <span className={cn("inline-flex", className)}>{mark}</span>;

  const dark = tone === "dark";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {mark}
      <span className="inline-flex items-baseline">
        <span className="font-display text-lg leading-none tracking-tight">
          <span className={cn("font-medium", dark && "text-brand-ground")}>Micro</span>
          <span className={cn("font-bold", dark ? "text-brand-teal-bright" : "text-primary")}>Trace</span>
        </span>
        {" "}
        <span className="ml-1.5 text-sm font-normal text-muted-foreground">Studio</span>
      </span>
    </span>
  );
}
