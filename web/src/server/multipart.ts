import busboy from "busboy";
import { Readable } from "node:stream";

export type MultipartLimits = {
  /** Taille maximale de la partie « file » (exactement cette taille est acceptée). */
  maxFileBytes: number;
  /** Taille maximale de la requête entière (fichier + enveloppe). */
  maxRequestBytes: number;
  /** Noms des champs texte conservés ; les autres sont ignorés. */
  fieldNames: readonly string[];
};

export type ParsedMultipart =
  | {
      kind: "ok";
      name: string;
      type: string;
      bytes: Buffer;
      fields: Record<string, string>;
    }
  | { kind: "too_big" }
  | { kind: "invalid" };

/**
 * Analyse le multipart en flux : seule la partie « file » est conservée, dans un unique tampon
 * borné ; la lecture s'interrompt dès qu'une limite est franchie.
 */
export function parseMultipart(
  request: Request,
  contentType: string,
  limits: MultipartLimits,
): Promise<ParsedMultipart> {
  return new Promise((resolve) => {
    if (!request.body) return resolve({ kind: "invalid" });
    let total = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > limits.maxRequestBytes) controller.error(new Error("limite"));
        else controller.enqueue(chunk);
      },
    });
    const source = Readable.fromWeb(request.body.pipeThrough(counter) as never);
    let bb: ReturnType<typeof busboy>;
    try {
      bb = busboy({
        headers: { "content-type": contentType },
        defParamCharset: "utf8",
        // busboy signale « limit » dès que la taille atteint la limite : +1 accepte exactement la taille max.
        limits: { fileSize: limits.maxFileBytes + 1, files: 1, fields: 5, fieldSize: 1024 },
      });
    } catch {
      source.destroy();
      return resolve({ kind: "invalid" });
    }
    let done = false;
    const finish = (r: ParsedMultipart) => {
      if (done) return;
      done = true;
      source.destroy();
      resolve(r);
    };
    const fields: Record<string, string> = {};
    let file: { name: string; type: string; chunks: Buffer[] } | null = null;
    bb.on("field", (name, value) => {
      if (limits.fieldNames.includes(name)) fields[name] = value;
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
      finish({ kind: "ok", name: file.name, type: file.type, bytes, fields });
    });
    bb.on("error", () => finish({ kind: "invalid" }));
    source.on("error", () =>
      finish(total > limits.maxRequestBytes ? { kind: "too_big" } : { kind: "invalid" }),
    );
    source.pipe(bb);
  });
}
