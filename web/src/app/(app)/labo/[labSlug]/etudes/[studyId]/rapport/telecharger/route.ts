import {
  attachment,
  authenticate,
  FILE_REFUSED,
  failure,
  headNotAllowed,
  nothingToExport,
  plain,
  REPORT_REFUSED,
} from "@/server/download-response";
import { buildReportDownload } from "@/server/report-download";
import type { DownloadFormat } from "@/server/report-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATS: readonly string[] = ["html", "md", "csv"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ labSlug: string; studyId: string }> },
): Promise<Response> {
  const { labSlug, studyId } = await params;
  const nav = { request, labSlug, studyId };
  const auth = await authenticate(labSlug, nav);
  if ("response" in auth) return auth.response;

  const format = new URL(request.url).searchParams.get("format");
  if (format === null || !FORMATS.includes(format)) {
    return plain("Format inconnu.", 400);
  }
  try {
    const result = await buildReportDownload(auth.ctx, studyId, format as DownloadFormat);
    if (result.kind === "empty") return nothingToExport(nav);
    return attachment(result, format === "html");
  } catch (e) {
    return failure(
      e,
      "rapport/telecharger",
      format === "csv" ? FILE_REFUSED : REPORT_REFUSED,
      nav,
    );
  }
}

export const HEAD = headNotAllowed;
