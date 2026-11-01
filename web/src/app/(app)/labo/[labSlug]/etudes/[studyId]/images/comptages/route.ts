import {
  attachment,
  authenticate,
  FILE_REFUSED,
  failure,
  headNotAllowed,
} from "@/server/download-response";
import { buildCountsCsv } from "@/server/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ labSlug: string; studyId: string }> },
): Promise<Response> {
  const { labSlug, studyId } = await params;
  const auth = await authenticate(labSlug);
  if ("response" in auth) return auth.response;
  try {
    return attachment(await buildCountsCsv(auth.ctx, studyId));
  } catch (e) {
    return failure(e, "images/comptages", FILE_REFUSED);
  }
}

export const HEAD = headNotAllowed;
