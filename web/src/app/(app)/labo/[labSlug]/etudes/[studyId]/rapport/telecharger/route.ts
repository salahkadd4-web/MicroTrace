import {
  attachment,
  authenticate,
  failure,
  NOTHING_TO_EXPORT,
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
  const auth = await authenticate(labSlug);
  if ("response" in auth) return auth.response;

  const format = new URL(request.url).searchParams.get("format");
  if (format === null || !FORMATS.includes(format)) {
    return plain("Format inconnu.", 400);
  }
  try {
    const result = await buildReportDownload(auth.ctx, studyId, format as DownloadFormat);
    if (result.kind === "empty") return plain(NOTHING_TO_EXPORT, 409);
    return attachment(result, format === "html");
  } catch (e) {
    return failure(e, "rapport/telecharger", REPORT_REFUSED);
  }
}
