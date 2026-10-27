"use client";

import { useState } from "react";
import { FormError } from "@/components/app/FormError";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ImportResult } from "@/server/engine/client";
import { importIssuesAction } from "./actions";
import { IssuesTable } from "./IssuesTable";

/** « Problèmes » d'un import enregistré : charge les issues à l'ouverture et les affiche en lecture seule. */
export function ImportIssues({
  labSlug,
  importRunId,
  fileName,
}: {
  labSlug: string;
  importRunId: string;
  fileName: string;
}) {
  const [issues, setIssues] = useState<ImportResult["issues"] | null>(null);
  const [error, setError] = useState<string | undefined>();

  async function onOpenChange(open: boolean) {
    if (!open || issues) return;
    setError(undefined);
    const res = await importIssuesAction(labSlug, importRunId);
    if (res.error !== undefined) setError(res.error);
    else setIssues(res.data);
  }

  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Problèmes
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Problèmes signalés</DialogTitle>
          <DialogDescription>{fileName}</DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        {issues ? (
          <div className="max-h-[60vh] overflow-auto">
            <IssuesTable issues={issues} />
          </div>
        ) : error ? null : (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
