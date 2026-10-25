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

/** Instance PostgreSQL embarquée pour les tests (jamais le service local). */
export default async function setup(): Promise<() => Promise<void>> {
  const dir = mkdtempSync(join(tmpdir(), "microtrace-pg-"));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("microtrace_test");

  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/microtrace_test`;
  process.env.DATABASE_URL = url;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" },
  );

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
