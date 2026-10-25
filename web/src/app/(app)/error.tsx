"use client";

import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      title="Une erreur est survenue"
      description="La page n'a pas pu être affichée. Réessayez, ou revenez à la liste des projets."
      action={<Button onClick={reset}>Réessayer</Button>}
    />
  );
}
