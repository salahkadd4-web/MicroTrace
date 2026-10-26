import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type LabLink = { slug: string; name: string };

export function AppShell({
  userName,
  signOutAction,
  lab,
  labs = [],
  children,
}: {
  userName: string;
  lab?: LabLink;
  /** Laboratoires de l'utilisateur : le sélecteur n'apparaît qu'à partir de deux. */
  labs?: LabLink[];
  signOutAction: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold">
              MicroTrace Studio
            </Link>
            {lab ? (
              <>
                <span className="text-sm font-medium">{lab.name}</span>
                <nav aria-label="Navigation principale">
                  <Link
                    href={`/labo/${lab.slug}/projets`}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Projets
                  </Link>
                </nav>
              </>
            ) : null}
            {lab && labs.length >= 2 ? (
              <nav aria-label="Laboratoires" className="flex gap-3 text-sm">
                {labs.map((l) => (
                  <Link
                    key={l.slug}
                    href={`/labo/${l.slug}/projets`}
                    aria-current={l.slug === lab.slug ? "true" : undefined}
                    className="text-muted-foreground hover:text-foreground aria-[current=true]:font-medium aria-[current=true]:text-foreground aria-[current=true]:underline"
                  >
                    {l.name}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span>{userName}</span>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Se déconnecter
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
