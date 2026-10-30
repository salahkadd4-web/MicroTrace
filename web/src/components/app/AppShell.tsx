import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/app/Logo";
import { NavLink } from "@/components/app/NavLink";
import { Button } from "@/components/ui/button";

type LabLink = { slug: string; name: string };

export function AppShell({
  userName,
  signOutAction,
  lab,
  labs = [],
  canManageMembers = false,
  isPlatformAdmin = false,
  children,
}: {
  userName: string;
  /** Responsable du laboratoire courant : lien « Membres ». */
  canManageMembers?: boolean;
  /** Équipe de la plateforme : lien « Console ». */
  isPlatformAdmin?: boolean;
  lab?: LabLink;
  /** Laboratoires de l'utilisateur : le sélecteur n'apparaît qu'à partir de deux. */
  labs?: LabLink[];
  signOutAction: () => void | Promise<void>;
  children: ReactNode;
}) {
  const showSwitcher = Boolean(lab) && labs.length >= 2;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b bg-card">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-6">
          <Link
            href={lab ? `/labo/${lab.slug}/projets` : "/"}
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Logo variant="full" />
          </Link>
          {lab ? (
            <>
              <span aria-hidden="true" className="h-6 w-px bg-border" />
              {showSwitcher ? null : <span className="text-sm font-semibold">{lab.name}</span>}
              <nav aria-label="Navigation principale" className="flex items-center gap-1">
                <NavLink href={`/labo/${lab.slug}/projets`}>Projets</NavLink>
                {canManageMembers ? (
                  <NavLink href={`/labo/${lab.slug}/membres`}>Membres</NavLink>
                ) : null}
              </nav>
            </>
          ) : null}
          <div className="ml-auto flex items-center gap-3 text-sm">
            {isPlatformAdmin ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin">Console</Link>
              </Button>
            ) : null}
            {lab && showSwitcher ? (
              <nav aria-label="Laboratoires" className="inline-flex rounded-lg border bg-muted p-0.5">
                {labs.map((l) => (
                  <Link
                    key={l.slug}
                    href={`/labo/${l.slug}/projets`}
                    aria-current={l.slug === lab.slug ? "true" : undefined}
                    className="inline-flex h-7 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=true]:bg-card aria-[current=true]:font-medium aria-[current=true]:text-foreground aria-[current=true]:shadow-xs"
                  >
                    {l.name}
                  </Link>
                ))}
              </nav>
            ) : null}
            <span className="text-muted-foreground">{userName}</span>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Se déconnecter
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-8">{children}</main>
    </div>
  );
}
