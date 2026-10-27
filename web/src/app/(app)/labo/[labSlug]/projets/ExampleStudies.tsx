"use client";

import { useActionState, useTransition } from "react";
import { FormError } from "@/components/app/FormError";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";
import { createExampleStudyAction } from "./actions";

type Kind = "fictif" | "leslie2022";

export function ExampleStudies({ labSlug }: { labSlug: string }) {
  const [state, run, actionPending] = useActionState<ActionState, Kind>(
    createExampleStudyAction.bind(null, labSlug),
    {},
  );
  const [, startTransition] = useTransition();
  const start = (kind: Kind) => startTransition(() => run(kind));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Étude fictive (données simulées façon Leslie 2022), pour essayer l&apos;import et les analyses
          sans données réelles.
        </p>
        <Button type="button" variant="outline" disabled={actionPending} onClick={() => start("fictif")}>
          {actionPending ? "Création…" : "Créer l'étude d'exemple (fictive)"}
        </Button>
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Données publiées : Leslie et al., Environment International 163 (2022) 107199, licence CC
          BY 4.0.
        </p>
        <Button type="button" variant="outline" disabled={actionPending} onClick={() => start("leslie2022")}>
          {actionPending ? "Création…" : "Créer l'étude d'exemple réelle (Leslie et al. 2022)"}
        </Button>
      </div>
      <FormError message={state.error} />
    </div>
  );
}
