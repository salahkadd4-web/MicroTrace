import busboy from "busboy";
import { Readable } from "node:stream";
import {
  EngineError,
  EngineUnavailableError,
  engineClient,
} from "@/server/engine/client";
import { DomainError } from "@/server/errors";
import { putStaging } from "@/server/file-store";
import { requireLab } from "@/server/lab-context";
import { prisma } from "@/server/db";
import { assertWritable } from "@/server/studies";

export const runtime = "nodejs";

/** Taille maximale du fichier (identique à MAX_BYTES du moteur). */
const MAX_BYTES = 50 * 1024 * 1024;
/** Marge pour l'enveloppe multipart (frontières, en-têtes, champ « sheet »). */
const MULTIPART_OVERHEAD = 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_BYTES + MULTIPART_OVERHEAD;

const TOO_BIG = "Fichier trop volumineux (50 Mo maximum).";
const ARCHIVED = "Étude archivée : lecture seule.";
const UNEXPECTED = "Une erreur inattendue est survenue.";

const fail = (error: string, status: number) =>
  Response.json({ error }, { status });

type Parsed =
  | {
      kind: "ok";
      name: string;
      type: string;
      bytes: Buffer;
      sheet: string | null;
    }
  | { kind: "too_big" }
  | { kind: "invalid" };

/**
 * Analyse le multipart en flux : seule la partie « file » est conservée, dans un unique tampon
 * borné ; la lecture s'interrompt dès qu'une limite est franchie.
 */
function parseUpload(request: Request, contentType: string): Promise<Parsed> {
  return new Promise((resolve) => {
    if (!request.body) return resolve({ kind: "invalid" });
    let total = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > MAX_REQUEST_BYTES) controller.error(new Error("limite"));
        else controller.enqueue(chunk);
      },
    });
    const source = Readable.fromWeb(request.body.pipeThrough(counter) as never);
    let bb: ReturnType<typeof busboy>;
    try {
      bb = busboy({
        headers: { "content-type": contentType },
        defParamCharset: "utf8",
        // busboy signale « limit » dès que la taille atteint la limite : +1 accepte exactement 50 Mo.
        limits: { fileSize: MAX_BYTES + 1, files: 1, fields: 5, fieldSize: 1024 },
      });
    } catch {
      source.destroy();
      return resolve({ kind: "invalid" });
    }
    let done = false;
    const finish = (r: Parsed) => {
      if (done) return;
      done = true;
      source.destroy();
      resolve(r);
    };
    let sheet: string | null = null;
    let file: { name: string; type: string; chunks: Buffer[] } | null = null;
    bb.on("field", (name, value) => {
      if (name === "sheet" && value.trim()) sheet = value;
    });
    bb.on("file", (name, stream, info) => {
      if (name !== "file" || file) return void stream.resume();
      const current = {
        name: info.filename ?? "fichier",
        type: info.mimeType,
        chunks: [] as Buffer[],
      };
      file = current;
      stream.on("data", (c: Buffer) => current.chunks.push(c));
      stream.on("limit", () => finish({ kind: "too_big" }));
    });
    bb.on("close", () => {
      if (!file) return finish({ kind: "invalid" });
      const bytes = Buffer.concat(file.chunks);
      finish({ kind: "ok", name: file.name, type: file.type, bytes, sheet });
    });
    bb.on("error", () => finish({ kind: "invalid" }));
    source.on("error", () =>
      finish(
        total > MAX_REQUEST_BYTES ? { kind: "too_big" } : { kind: "invalid" },
      ),
    );
    source.pipe(bb);
  });
}

function digestOf(e: unknown): string {
  if (typeof e === "object" && e !== null && "digest" in e) {
    return String((e as { digest: unknown }).digest);
  }
  return "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ labSlug: string; studyId: string }> },
): Promise<Response> {
  try {
    const { labSlug, studyId } = await params;

    let ctx;
    try {
      ctx = await requireLab(labSlug, "researcher");
    } catch (e) {
      const digest = digestOf(e);
      if (digest.startsWith("NEXT_REDIRECT"))
        return fail("Authentification requise.", 401);
      if (digest.includes("404")) return fail("Introuvable.", 404);
      throw e;
    }

    const study = await prisma.study.findFirst({
      where: { id: studyId, laboratoryId: ctx.laboratoryId },
      select: { id: true, archivedAt: true },
    });
    if (!study) return fail("Introuvable.", 404);
    assertWritable(study);

    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES)
      return fail(TOO_BIG, 413);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return fail("Requête invalide.", 400);
    }
    const parsed = await parseUpload(request, contentType);
    if (parsed.kind === "too_big") return fail(TOO_BIG, 413);
    if (parsed.kind === "invalid" || parsed.bytes.length === 0) {
      return fail("Aucun fichier reçu.", 400);
    }
    const { name, type, sheet } = parsed;
    const bytes = new Uint8Array(
      parsed.bytes.buffer,
      parsed.bytes.byteOffset,
      parsed.bytes.length,
    ) as Uint8Array<ArrayBuffer>;

    const table = await engineClient.readTable(
      { data: bytes, filename: name },
      sheet,
    );
    const { token } = await putStaging(
      { userId: ctx.userId, laboratoryId: ctx.laboratoryId, studyId },
      { name, type, bytes },
    );
    return Response.json({ token, table });
  } catch (e) {
    if (e instanceof DomainError)
      return fail(e.message, e.message === ARCHIVED ? 409 : 403);
    if (e instanceof EngineUnavailableError) {
      return fail("Le moteur d'analyse est indisponible.", 503);
    }
    if (e instanceof EngineError && (e.status === 422 || e.status === 413)) {
      return fail(e.detail, e.status);
    }
    // Journal sans contenu : ni message (qui peut citer le fichier), ni nom de fichier, ni jeton.
    console.error(
      "[import/upload] erreur inattendue :",
      e instanceof Error ? e.name : typeof e,
    );
    return fail(UNEXPECTED, 500);
  }
}
