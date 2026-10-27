"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-state";
import type { ImportResult, Mapping, TableRead } from "@/server/engine/client";
import {
  checkStagedImport,
  getImport,
  readStagedSheet,
  retireImport,
  saveImport,
  suggestStagedMapping,
} from "@/server/imports";
import { DomainError } from "@/server/errors";
import { runAction } from "@/server/run-action";

/** Ce que le navigateur reçoit d'un contrôle : jamais les mesures, seulement les issues et les comptes. */
export type CheckSummary = Pick<ImportResult, "issues" | "counts" | "n_rows" | "sheet">;

/** Rafraîchit l'étude et tous ses onglets (le journal et la liste changent à chaque écriture). */
function refresh(labSlug: string, studyId: string): void {
  revalidatePath(`/labo/${labSlug}/etudes/${studyId}`, "layout");
}

/** Action qui renvoie une donnée : erreurs traduites par `runAction`, résultat capturé. */
async function withData<T>(
  labSlug: string,
  fn: (ctx: Parameters<Parameters<typeof runAction>[1]>[0]) => Promise<T>,
  minRole?: Parameters<typeof runAction>[2],
): Promise<ActionResult<T>> {
  let data: T | undefined;
  const state = await runAction(
    labSlug,
    async (ctx) => {
      data = await fn(ctx);
    },
    minRole,
  );
  if (state.error !== undefined) return { error: state.error };
  return { data: data as T };
}

export async function suggestMappingAction(
  labSlug: string,
  studyId: string,
  token: string,
  sheet: string | null,
): Promise<ActionResult<Mapping>> {
  return withData(labSlug, (ctx) => suggestStagedMapping(ctx, studyId, token, sheet));
}

/** Relit une autre feuille du dépôt : colonnes et aperçu de cette feuille (jamais les octets). */
export async function readSheetAction(
  labSlug: string,
  studyId: string,
  token: string,
  sheet: string | null,
): Promise<ActionResult<Pick<TableRead, "sheet" | "sheets" | "columns" | "preview" | "n_rows">>> {
  return withData(labSlug, async (ctx) => {
    const { sheet: read, sheets, columns, preview, n_rows } = await readStagedSheet(ctx, studyId, token, sheet);
    return { sheet: read, sheets, columns, preview, n_rows };
  });
}

export async function checkImportAction(
  labSlug: string,
  studyId: string,
  input: { token: string; sheet: string | null; mapping: Mapping },
): Promise<ActionResult<CheckSummary>> {
  return withData(labSlug, async (ctx) => {
    const { issues, counts, n_rows, sheet } = await checkStagedImport(ctx, studyId, input);
    return { issues, counts, n_rows, sheet };
  });
}

export async function saveImportAction(
  labSlug: string,
  studyId: string,
  input: { token: string; sheet: string | null; mapping: Mapping; acceptWarnings: boolean },
): Promise<ActionResult<{ importRunId: string }>> {
  return withData(labSlug, async (ctx) => {
    const saved = await saveImport(ctx, studyId, input);
    refresh(labSlug, studyId);
    return saved;
  });
}

export async function retireImportAction(
  labSlug: string,
  importRunId: string,
  reason: string,
): Promise<ActionState> {
  return runAction(labSlug, async (ctx) => {
    await retireImport(ctx, importRunId, reason);
    // L'étude de l'import n'est pas connue du client : on rafraîchit les pages de l'application.
    revalidatePath("/labo/[labSlug]/etudes/[studyId]", "layout");
  });
}

/** Issues d'un import enregistré (lecture : tous les rôles). */
export async function importIssuesAction(
  labSlug: string,
  importRunId: string,
): Promise<ActionResult<ImportResult["issues"]>> {
  return withData(
    labSlug,
    async (ctx) => {
      const run = await getImport(ctx, importRunId);
      if (!run) throw new DomainError("Import introuvable.");
      return (Array.isArray(run.issues) ? run.issues : []) as unknown as ImportResult["issues"];
    },
    "viewer",
  );
}
