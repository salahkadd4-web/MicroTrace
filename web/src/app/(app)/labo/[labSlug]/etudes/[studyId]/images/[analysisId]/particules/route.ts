import {
  attachment,
  authenticate,
  FILE_REFUSED,
  failure,
  headNotAllowed,
} from "@/server/download-response";
import { buildParticlesCsv } from "@/server/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ labSlug: string; studyId: string; analysisId: string }> },
): Promise<Response> {
  const { labSlug, studyId, analysisId } = await params;
  const auth = await authenticate(labSlug);
  if ("response" in auth) return auth.response;
  try {
    return attachment(await buildParticlesCsv(auth.ctx, studyId, analysisId));
  } catch (e) {
    return failure(e, "images/particules", FILE_REFUSED);
  }
}

export const HEAD = headNotAllowed;
