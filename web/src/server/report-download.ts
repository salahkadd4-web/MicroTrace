import "server-only";
import { prisma } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { engineClient, type ReportRequest } from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import type { LabContext } from "@/server/lab-context";
import { assertRole } from "@/server/lab-role";
import {
  parseDictionaryNames,
  reportFileName,
  toCsv,
  type CsvValue,
  type DownloadFormat,
} from "@/server/report-files";
import { loadActiveResultsInput } from "@/server/results";

export type DownloadFile = {
  body: string;
  contentType: string;
  fileName: string;
};

export type ReportDownload = { kind: "empty" } | ({ kind: "ok" } & DownloadFile);

/** Champ du dictionnaire dont le nom diffère de celui du record du moteur. */
const RECORD_KEY_OF: Record<string, string> = { detection_status: "status" };

const CONTENT_TYPES: Record<DownloadFormat, string> = {
  html: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

/**
 * Rapport (HTML ou Markdown, tels que renvoyés par le moteur) ou CSV des mesures actives d'une
 * étude du laboratoire. Rôle viewer ; une étude archivée reste téléchargeable. L'événement
 * `report.download` n'est écrit qu'une fois le contenu produit. Les erreurs du moteur
 * (EngineUnavailableError, EngineError) sont relancées à l'appelant.
 */
export async function buildReportDownload(
  ctx: LabContext,
  studyId: string,
  format: DownloadFormat,
): Promise<ReportDownload> {
  const input = await loadActiveResultsInput(ctx, studyId, { withIssues: format !== "csv" });
  if (input.records.length === 0) return { kind: "empty" };
  const generatedAt = new Date();
  const fileName = reportFileName(
    format,
    input.study.title,
    generatedAt,
    input.study.nature === "simulated",
  );

  let body: string;
  if (format === "csv") {
    const names = parseDictionaryNames((await engineClient.dictionary()).csv);
    const dictionaryKeys = names.map((n) => RECORD_KEY_OF[n] ?? n);
    if (dictionaryKeys.some((k) => !(k in input.records[0]))) {
      throw new Error("Champ du dictionnaire absent des mesures.");
    }
    // Puis tous les autres champs enregistrés (valeurs dérivées, ligne et colonne source…), dans
    // l'ordre du record ; l'en-tête est la clé du record.
    const extraKeys = Object.keys(input.records[0]).filter((k) => !dictionaryKeys.includes(k));
    const keys = [...dictionaryKeys, ...extraKeys];
    const fileOf = new Map(input.imports.map((i) => [i.id, i.fileName]));
    const rows: CsvValue[][] = input.records.map((rec, i) => [
      ...keys.map((k) => (rec as unknown as Record<string, CsvValue>)[k]),
      input.study.nature,
      fileOf.get(input.recordImportIds[i]) ?? "",
    ]);
    body = toCsv([...names, ...extraKeys, "data_nature", "import"], rows);
  } else {
    const request: ReportRequest = {
      study: { title: input.study.title },
      imports: input.imports.map((i) => ({
        file: { name: i.fileName, sha256: i.sha256, size: i.sizeBytes, sheet: i.sheet },
        rules_version: i.rulesVersion,
        date: i.createdAt.toISOString(),
        author: i.author ?? "Inconnu",
        issues: i.issues,
      })),
      records: input.records,
      qc_records: input.qcRecords,
      context: input.context,
      context_changed: input.contextChanged,
      generated_at: generatedAt.toISOString(),
    };
    const report = await engineClient.report(request);
    body = format === "html" ? report.html : report.markdown;
  }

  await prisma.$transaction((tx) =>
    recordAudit(tx, {
      actorId: ctx.userId,
      action: "report.download",
      entityType: "Study",
      entityId: studyId,
      laboratoryId: ctx.laboratoryId,
      after: { format },
    }),
  );
  return { kind: "ok", body, contentType: CONTENT_TYPES[format], fileName };
}

/** Dictionnaire de données du moteur (CSV ou Markdown) ; non audité. Rôle viewer. */
export async function buildDictionaryDownload(
  ctx: LabContext,
  studyId: string,
  format: "csv" | "md",
): Promise<DownloadFile> {
  assertRole(ctx, "viewer");
  const study = await prisma.study.findFirst({
    where: { id: studyId, laboratoryId: ctx.laboratoryId },
    select: { id: true },
  });
  if (!study) throw new DomainError("Étude introuvable.");
  const dictionary = await engineClient.dictionary();
  return format === "csv"
    ? {
        body: dictionary.csv.startsWith("﻿") ? dictionary.csv : `﻿${dictionary.csv}`,
        contentType: CONTENT_TYPES.csv,
        fileName: "dictionnaire-donnees.csv",
      }
    : {
        body: dictionary.markdown,
        contentType: CONTENT_TYPES.md,
        fileName: "dictionnaire-donnees.md",
      };
}

/** Y a-t-il des mesures actives à exporter ? (compte seulement, sans charger les mesures.) */
export async function getReportAvailability(
  ctx: LabContext,
  studyId: string,
): Promise<{ hasMeasurements: boolean }> {
  assertRole(ctx, "viewer");
  const study = await prisma.study.findFirst({
    where: { id: studyId, laboratoryId: ctx.laboratoryId },
    select: { id: true },
  });
  if (!study) throw new DomainError("Étude introuvable.");
  const count = await prisma.measurement.count({
    where: {
      studyId,
      study: { laboratoryId: ctx.laboratoryId },
      importRun: { status: "active" },
    },
  });
  return { hasMeasurements: count > 0 };
}
