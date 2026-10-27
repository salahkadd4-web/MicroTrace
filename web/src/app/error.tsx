"use client";

import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";

/** Garde-fou racine (pages publiques comprises) : jamais la page d'erreur anglaise de Next. */
export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-sm p-6">
      <EmptyState
        title="Une erreur est survenue"
        description="La page n'a pas pu être affichée. Réessayez dans un instant."
        action={<Button onClick={reset}>Réessayer</Button>}
      />
    </main>
  );
}
