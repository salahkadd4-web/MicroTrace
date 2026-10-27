import { describe, expect, it, vi } from "vitest";
import {
  createEngineClient,
  EngineError,
  EngineUnavailableError,
  type FetchLike,
  type StudyContext,
} from "../client";

const config = () => ({ url: "http://engine.test/", secret: "s".repeat(40) });

const validContext = {
  data_nature: "simulated",
  methods: [{ name: "Py-GC/MS", technique: "py_gc_ms" }],
  limits: [],
  blank_corrected: "unknown",
} satisfies StudyContext;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(respond: () => Response | Promise<Response>) {
  const fetch = vi.fn<FetchLike>(async () => respond());
  return { fetch, client: createEngineClient({ fetch, config }) };
}

describe("engineClient", () => {
  it("envoie le secret et le contexte en JSON", async () => {
    const { fetch, client } = setup(() => json(200, { ok: true }));
    await expect(client.validateContext(validContext)).resolves.toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://engine.test/context/validate");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Engine-Secret"]).toBe("s".repeat(40));
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(validContext);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("validation du contexte : délai court de 15 s ; autres appels : 120 s", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    try {
      const { client } = setup(() => json(200, {}));
      await client.validateContext(validContext);
      await client.dictionary();
      expect(spy.mock.calls.map((c) => c[0])).toEqual([15_000, 120_000]);
    } finally {
      spy.mockRestore();
    }
  });

  it("n'envoie pas le secret à /health", async () => {
    const { fetch, client } = setup(() =>
      json(200, { engine_api: 1, engine_version: "x", rules_version: "y" }),
    );
    await client.health();
    expect((fetch.mock.calls[0][1].headers as Record<string, string>)["X-Engine-Secret"]).toBeUndefined();
  });

  it("envoie existing comme partie fichier JSON", async () => {
    const { fetch, client } = setup(() => json(200, { records: [] }));
    const existing = [{ sample_id: "S1", aliquot: "A", polymer: "PE", method: "m" }];
    await client.checkImport({
      file: { data: new TextEncoder().encode("a;b\n1;2"), filename: "d.csv" },
      sheet: null,
      mapping: { field_columns: {}, polymer_columns: {} } as never,
      context: validContext,
      existing: existing as never,
    });
    const form = fetch.mock.calls[0][1].body as FormData;
    const part = form.get("existing") as File;
    expect(part).toBeInstanceOf(File);
    expect(part.name).toBe("existing.json");
    expect(part.type).toBe("application/json");
    expect(JSON.parse(await part.text())).toEqual(existing);
    expect(typeof form.get("mapping")).toBe("string");
    expect(typeof form.get("context")).toBe("string");
    expect((form.get("file") as File).name).toBe("d.csv");
    expect(form.has("sheet")).toBe(false);
  });

  it("omet existing quand il est absent", async () => {
    const { fetch, client } = setup(() => json(200, {}));
    await client.checkImport({
      file: { data: new Blob(["x"]), filename: "d.csv" },
      mapping: {} as never,
      context: validContext,
    });
    expect((fetch.mock.calls[0][1].body as FormData).has("existing")).toBe(false);
  });

  it("transforme une 422 en EngineError avec le détail français", async () => {
    const { client } = setup(() => json(422, { detail: "Méthode « A » déclarée deux fois" }));
    const err = await client.validateContext(validContext).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).status).toBe(422);
    expect((err as EngineError).detail).toBe("Méthode « A » déclarée deux fois");
  });

  it("donne un message générique si le corps d'erreur n'est pas JSON", async () => {
    const { client } = setup(() => new Response("<html>", { status: 502 }));
    const err = (await client.dictionary().catch((e: unknown) => e)) as EngineError;
    expect(err).toBeInstanceOf(EngineError);
    expect(err.status).toBe(502);
    expect(err.detail).toMatch(/moteur/);
  });

  it("transforme une connexion refusée ou un délai en EngineUnavailableError", async () => {
    const { client } = setup(() => {
      throw new TypeError("fetch failed");
    });
    const err = await client.example().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineUnavailableError);
    expect((err as Error).message).toBe("Le moteur d'analyse est indisponible.");
  });

  it("signale une configuration manquante à l'appel, pas à l'import", async () => {
    vi.stubEnv("ENGINE_URL", "");
    vi.stubEnv("ENGINE_SECRET", "");
    const client = createEngineClient({ fetch: vi.fn() });
    await expect(client.dictionary()).rejects.toThrow(/ENGINE_URL et ENGINE_SECRET/);
    vi.unstubAllEnvs();
  });
});
