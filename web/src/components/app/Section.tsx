import { useId, type ReactNode } from "react";

/** Bloc de page : carte blanche, titre h2 (Space Grotesk), description et actions facultatives. */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 id={headingId} className="font-heading text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
