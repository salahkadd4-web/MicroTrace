import "server-only";
import type { components } from "./schema";

type S = components["schemas"];
export type StudyContext = S["StudyContextModel"];
export type Mapping = S["MappingModel"];
export type ExistingKey = S["ExistingKeyModel"];
export type ImportResult = S["ImportResultModel"];
export type TableRead = S["TableReadResponse"];
export type Health = S["HealthResponse"];
export type SummaryRequest = S["SummaryRequest"];
export type SummaryResponse = S["SummaryResponse"];
export type ReportRequest = S["ReportRequest"];
export type ReportResponse = S["ReportResponse"];
export type Dictionary = S["DictionaryResponse"];
export type Example = S["ExampleResponse"];

export const ENGINE_TIMEOUT_MS = 120_000;
/** La validation d'un contexte est rapide : délai court, car elle tient une transaction ouverte. */
export const ENGINE_VALIDATE_TIMEOUT_MS = 15_000;
export const UNAVAILABLE_MESSAGE = "Le moteur d'analyse est indisponible.";

/** Réponse d'erreur du moteur (ErrorModel) : `detail` est un message français. */
export class EngineError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly errors?: S["ErrorModel"]["errors"],
  ) {
    super(detail);
    this.name = "EngineError";
  }
}

/** Moteur injoignable, délai dépassé ou réponse illisible. */
export class EngineUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "EngineUnavailableError";
  }
}

export type EngineConfig = { url: string; secret: string };
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type ClientOptions = {
  fetch?: FetchLike;
  config?: () => EngineConfig;
  timeoutMs?: number;
};
export type UploadInput = { data: Blob | Uint8Array<ArrayBuffer>; filename: string };

function envConfig(): EngineConfig {
  const url = process.env.ENGINE_URL;
  const secret = process.env.ENGINE_SECRET;
  if (!url || !secret) {
    throw new Error(
      "Configuration du moteur manquante : ENGINE_URL et ENGINE_SECRET doivent être définis.",
    );
  }
  return { url: url.replace(/\/+$/, ""), secret };
}

function toBlob(data: UploadInput["data"]): Blob {
  return data instanceof Blob ? data : new Blob([data]);
}

async function errorFrom(res: Response): Promise<EngineError> {
  let detail = `Erreur du moteur d'analyse (code ${res.status}).`;
  let errors: S["ErrorModel"]["errors"];
  try {
    const body = (await res.json()) as Partial<S["ErrorModel"]>;
    if (typeof body.detail === "string") detail = body.detail;
    if (Array.isArray(body.errors)) errors = body.errors;
  } catch {
    // corps non JSON : message générique
  }
  return new EngineError(res.status, detail, errors);
}

export function createEngineClient(options: ClientOptions = {}) {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const getConfig = options.config ?? envConfig;
  const timeoutMs = options.timeoutMs ?? ENGINE_TIMEOUT_MS;

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: { json?: unknown; form?: FormData },
    auth = true,
    callTimeoutMs = timeoutMs,
  ): Promise<T> {
    const { url: rawUrl, secret } = getConfig();
    const url = rawUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {};
    if (auth) headers["X-Engine-Secret"] = secret;
    let payload: BodyInit | undefined;
    if (body?.form) {
      payload = body.form; // Content-Type multipart posé par fetch
    } else if (body && "json" in body) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body.json);
    }
    let res: Response;
    try {
      res = await doFetch(`${url}${path}`, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(callTimeoutMs),
        cache: "no-store",
      });
    } catch {
      throw new EngineUnavailableError();
    }
    if (!res.ok) throw await errorFrom(res);
    try {
      return (await res.json()) as T;
    } catch {
      throw new EngineUnavailableError();
    }
  }

  function fileForm(file: UploadInput, sheet?: string | null): FormData {
    const form = new FormData();
    form.append("file", toBlob(file.data), file.filename);
    if (sheet) form.append("sheet", sheet);
    return form;
  }

  return {
    health: () => call<Health>("GET", "/health", undefined, false),
    validateContext: (ctx: StudyContext) =>
      call<S["ValidateResponse"]>(
        "POST",
        "/context/validate",
        { json: ctx },
        true,
        options.timeoutMs ?? ENGINE_VALIDATE_TIMEOUT_MS,
      ),
    example: () => call<Example>("GET", "/examples/leslie-like"),
    readTable: (file: UploadInput, sheet?: string | null) =>
      call<TableRead>("POST", "/tables/read", { form: fileForm(file, sheet) }),
    suggestMapping: (file: UploadInput, sheet?: string | null) =>
      call<Mapping>("POST", "/mapping/suggest", { form: fileForm(file, sheet) }),
    checkImport: (args: {
      file: UploadInput;
      sheet?: string | null;
      mapping: Mapping;
      context: StudyContext;
      existing?: ExistingKey[];
    }) => {
      const form = fileForm(args.file, args.sheet);
      form.append("mapping", JSON.stringify(args.mapping));
      form.append("context", JSON.stringify(args.context));
      if (args.existing) {
        form.append(
          "existing",
          new Blob([JSON.stringify(args.existing)], { type: "application/json" }),
          "existing.json",
        );
      }
      return call<ImportResult>("POST", "/imports/check", { form });
    },
    summary: (req: SummaryRequest) => call<SummaryResponse>("POST", "/summary", { json: req }),
    report: (req: ReportRequest) => call<ReportResponse>("POST", "/report", { json: req }),
    dictionary: () => call<Dictionary>("GET", "/dictionary"),
  };
}

export type EngineClient = ReturnType<typeof createEngineClient>;

export const engineClient: EngineClient = createEngineClient();
