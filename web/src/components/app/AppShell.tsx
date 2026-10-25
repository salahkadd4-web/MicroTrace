import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function AppShell({
  userName,
  signOutAction,
  children,
}: {
  userName: string;
  signOutAction: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/projets" className="font-semibold">
              MicroTrace Studio
            </Link>
            <nav aria-label="Navigation principale">
              <Link
                href="/projets"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Projets
              </Link>
            </nav>
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
