import {
  attachment,
  authenticate,
  failure,
  plain,
  REPORT_REFUSED,
} from "@/server/download-response";
import { buildDictionaryDownload } from "@/server/report-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ labSlug: string; studyId: string }> },
): Promise<Response> {
  const { labSlug, studyId } = await params;
  const auth = await authenticate(labSlug);
  if ("response" in auth) return auth.response;

  const format = new URL(request.url).searchParams.get("format");
  if (format !== "csv" && format !== "md") return plain("Format inconnu.", 400);
  try {
    return attachment(await buildDictionaryDownload(auth.ctx, studyId, format));
  } catch (e) {
    return failure(e, "rapport/dictionnaire", REPORT_REFUSED);
  }
}
