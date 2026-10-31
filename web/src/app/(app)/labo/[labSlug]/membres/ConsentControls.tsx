"use client";

import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { TRAINING_CONSENT_DETAILS } from "@/lib/training-consent";
import { setTrainingConsentAction } from "./actions";

/** Active ou retire le consentement, après confirmation (le serveur reste juge du rôle et de l'état). */
export function ConsentControls({ labSlug, granted }: { labSlug: string; granted: boolean }) {
  return (
    <ConfirmDialog
      title={granted ? "Retirer le consentement ?" : "Activer le consentement ?"}
      description={
        granted
          ? "Le retrait s'applique aux prochains entraînements. Les exports déjà faits ne sont pas repris."
          : TRAINING_CONSENT_DETAILS.join(" ")
      }
      confirmLabel={granted ? "Retirer le consentement" : "Activer le consentement"}
      confirmVariant={granted ? "destructive" : "default"}
      onConfirm={async () => (await setTrainingConsentAction(labSlug, !granted)).error}
      trigger={
        <Button variant={granted ? "outline" : "default"}>
          {granted ? "Retirer le consentement" : "Activer le consentement"}
        </Button>
      }
    />
  );
}
