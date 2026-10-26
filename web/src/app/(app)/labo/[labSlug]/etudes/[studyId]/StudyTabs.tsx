"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { segment: "parametres", label: "Paramètres" },
  { segment: "imports", label: "Imports" },
  { segment: "resultats", label: "Résultats" },
  { segment: "rapport", label: "Rapport" },
  { segment: "journal", label: "Journal" },
] as const;

/** Onglets de l'étude : de vrais liens, l'onglet courant est marqué `aria-current="page"`. */
export function StudyTabs({ labSlug, studyId }: { labSlug: string; studyId: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections de l'étude" className="flex flex-wrap gap-1 border-b">
      {TABS.map((t) => {
        const href = `/labo/${labSlug}/etudes/${studyId}/${t.segment}`;
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={t.segment}
            href={href}
            aria-current={current ? "page" : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-foreground"
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
