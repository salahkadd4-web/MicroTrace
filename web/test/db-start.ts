import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export interface TestDb {
  url: string;
  dir: string;
  stop: () => Promise<void>;
}

export interface StartOptions {
  /** Appelé avec le répertoire temporaire dès sa création. */
  onDir?: (dir: string) => void;
  /** Appelé avec le port choisi. */
  onPort?: (port: number) => void;
  /** Étape injectée avant la migration (sert à tester le nettoyage). */
  beforeMigrate?: () => void | Promise<void>;
}

/** Démarre une instance PostgreSQL embarquée migrée ; nettoie tout en cas d'échec. */
export async function startTestDb(opts: StartOptions = {}): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "microtrace-pg-"));
  opts.onDir?.(dir);
  let started = false;
  let pg: EmbeddedPostgres | undefined;
  const stop = async () => {
    if (started && pg) {
      started = false;
      await pg.stop();
    }
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const port = await freePort();
    opts.onPort?.(port);
    pg = new EmbeddedPostgres({
      databaseDir: dir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("microtrace_test");
    await opts.beforeMigrate?.();
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/microtrace_test`;
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" },
    );
    return { url, dir, stop };
  } catch (err) {
    try {
      await stop();
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
    throw err;
  }
}

