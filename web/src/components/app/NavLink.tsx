"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Lien de navigation principale ; `aria-current="page"` quand la route courante est sous `href`. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  // Peut valoir null hors du routeur (tests) : alors aucun lien n'est actif.
  const pathname = usePathname();
  const active = pathname != null && (pathname === href || pathname.startsWith(`${href}/`));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        "aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
      )}
    >
      {children}
    </Link>
  );
}
