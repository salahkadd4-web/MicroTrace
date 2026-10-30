"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { segment: "parametres", label: "Paramètres" },
  { segment: "imports", label: "Imports" },
  { segment: "resultats", label: "Résultats" },
  { segment: "qualite", label: "Qualité" },
  { segment: "rapport", label: "Rapport" },
  { segment: "journal", label: "Journal" },
] as const;

/** Onglets de l'étude : de vrais liens, l'onglet courant est marqué `aria-current="page"`. */
export function StudyTabs({ labSlug, studyId }: { labSlug: string; studyId: string }) {
  const pathname = usePathname();
  return (
    <div className="sticky top-14 z-20 -mx-6 border-b bg-background/95 px-6 backdrop-blur">
      <nav aria-label="Sections de l'étude" className="flex gap-0 overflow-x-auto">
        {TABS.map((t) => {
          const href = `/labo/${labSlug}/etudes/${studyId}/${t.segment}`;
          const current = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={t.segment}
              href={href}
              aria-current={current ? "page" : undefined}
              className="inline-flex h-10 items-center border-b-2 border-transparent px-4 text-sm font-medium text-muted-foreground hover:border-border hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
