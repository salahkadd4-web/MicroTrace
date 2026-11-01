import { authenticate, failure, headNotAllowed, plain, pngResponse } from "@/server/download-response";
import { readAnalysisImage } from "@/server/images";

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
    const bytes = await readAnalysisImage(auth.ctx, studyId, analysisId, "display");
    if (!bytes) return plain("Introuvable.", 404);
    return pngResponse(bytes);
  } catch (e) {
    return failure(e, "images/image", "Le moteur d'analyse n'a pas pu produire le fichier.");
  }
}

export const HEAD = headNotAllowed;
