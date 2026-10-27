"use client";

import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { retireImportAction } from "./actions";

/** Retire un import actif : motif obligatoire, le dialogue reste ouvert si le serveur refuse. */
export function RetireButton({
  labSlug,
  importRunId,
  fileName,
}: {
  labSlug: string;
  importRunId: string;
  fileName: string;
}) {
  return (
    <ConfirmDialog
      title="Retirer l'import"
      description={`Les mesures de « ${fileName} » ne compteront plus dans l'étude. L'opération est enregistrée au journal. Indiquez le motif du retrait.`}
      confirmLabel="Retirer l'import"
      requireReason
      onConfirm={async (reason) => (await retireImportAction(labSlug, importRunId, reason ?? "")).error}
      trigger={
        <Button type="button" variant="outline" size="sm">
          Retirer
        </Button>
      }
    />
  );
}
