import "server-only";
import { EngineUnavailableError, engineClient } from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { putStaging } from "@/server/file-store";
import { saveImport } from "@/server/imports";
import { assertRole } from "@/server/lab-role";
import type { LabContext } from "@/server/lab-context";
import { createProject } from "@/server/projects";
import { createStudy } from "@/server/studies";
import { addMethod, upsertDetectionLimit } from "@/server/study-settings";

export type ExampleKind = "fictif" | "leslie2022";

const TITLES: Record<ExampleKind, { project: string; study: string }> = {
  leslie2022: {
    project: "Exemple — Leslie et al. 2022 (réel)",
    study: "Leslie et al. 2022 — Tableau S2 (sang total, Py-GC/MS)",
  },
  fictif: {
    project: "Exemple — étude fictive façon Leslie",
    study: "Étude fictive façon Leslie 2022",
  },
};

/**
 * Crée un projet, une étude, ses méthodes et limites, puis importe le CSV de l'exemple par le
 * même chemin que l'assistant (dépôt puis enregistrement), avertissements acceptés. Chaque appel
 * crée un nouvel exemple. Si l'import échoue, le projet et l'étude restent (jamais de suppression).
 */
export async function createExampleStudy(ctx: LabContext, kind: ExampleKind) {
  assertRole(ctx, "researcher");
  // Le moteur d'abord : indisponible, rien n'est écrit.
  const example = await (kind === "leslie2022"
    ? engineClient.exampleLeslie2022()
    : engineClient.example());
  const { context } = example;
  const titles = TITLES[kind];

  const project = await createProject(ctx, { title: titles.project });
  const study = await createStudy(ctx, project.id, {
    title: titles.study,
    nature: context.data_nature,
    referenceDoi: context.reference_doi,
    referenceLicense: context.reference_license,
    blankCorrected: context.blank_corrected,
  });

  const methodIds = new Map<string, string>();
  for (const m of context.methods) {
    const created = await addMethod(ctx, study.id, { name: m.name, technique: m.technique });
    methodIds.set(m.name, created.id);
  }
  for (const l of context.limits ?? []) {
    const methodId = methodIds.get(l.method);
    if (!methodId) throw new DomainError("Méthode introuvable.");
    await upsertDetectionLimit(ctx, study.id, {
      methodId,
      polymer: l.polymer,
      lod: l.lod ?? null,
      loq: l.loq ?? null,
      unitCode: l.unit_code,
      source: l.source,
    });
  }

  try {
    const { token } = await putStaging(
      { userId: ctx.userId, laboratoryId: ctx.laboratoryId, studyId: study.id },
      {
        name: example.filename,
        type: "text/csv",
        bytes: new Uint8Array(Buffer.from(example.csv_base64, "base64")),
      },
    );
    const { importRunId } = await saveImport(ctx, study.id, {
      token,
      sheet: null,
      mapping: example.mapping,
      acceptWarnings: true,
    });
    return { projectId: project.id, studyId: study.id, importRunId };
  } catch (e) {
    if (e instanceof DomainError || e instanceof EngineUnavailableError) {
      const reason = e.message.replace(/\.+$/, "");
      throw new DomainError(
        `L'étude d'exemple a été créée, mais son import a échoué : ${reason}.`,
      );
    }
    throw e;
  }
}
