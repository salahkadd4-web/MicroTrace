import { type ChildProcess, execFileSync } from "node:child_process";
import path from "node:path";
import { startTestDb, type TestDb } from "../test/db-start";
import {
  E2E_DIST_DIR,
  freePort,
  killTree,
  printLogTail,
  pythonPath,
  randomToken,
  REPO_DIR,
  removeDir,
  spawnLogged,
  tempDir,
  waitForHttp,
  WEB_DIR,
} from "./stack";

/**
 * Pile autonome : PostgreSQL embarqué (port libre, base migrée), moteur Python, application
 * compilée (`next build` dans un dossier à part) puis servie par `next start`. Tout est arrêté
 * et supprimé par la fonction renvoyée, même quand un test échoue.
 * Limite connue : un arrêt brutal du processus pendant `next build` peut laisser des processus
 * orphelins (postgres, moteur) que ce nettoyage ne voit pas.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  let db: TestDb | undefined;
  let engine: ChildProcess | undefined;
  let web: ChildProcess | undefined;
  const work = tempDir("microtrace-e2e-");
  const secrets: string[] = [];

  const teardown = async () => {
    killTree(web);
    killTree(engine);
    await db?.stop().catch(() => undefined);
    removeDir(work);
    removeDir(path.join(WEB_DIR, E2E_DIST_DIR));
  };

  try {
    db = await startTestDb();

    const enginePort = await freePort();
    const webPort = await freePort();
    const engineSecret = randomToken(48);
    const authSecret = randomToken(48);
    const password = `Mdp-${randomToken(24)}`;
    secrets.push(engineSecret, authSecret, password);
    const dbPassword = new URL(db.url).password;
    secrets.push(dbPassword, db.url);
    const engineUrl = `http://127.0.0.1:${enginePort}`;
    const webUrl = `http://127.0.0.1:${webPort}`;
    const varDir = path.join(work, "var");

    engine = spawnLogged(
      pythonPath(),
      ["-m", "microtrace_engine"],
      {
        ...process.env,
        ENGINE_SECRET: engineSecret,
        ENGINE_HOST: "127.0.0.1",
        ENGINE_PORT: String(enginePort),
      },
      REPO_DIR,
      path.join(work, "engine.log"),
    );
    await waitForHttp(`${engineUrl}/health`, "Le moteur", 60_000, () => engine?.exitCode === null, (body) => {
      try {
        const h = JSON.parse(body) as { engine_api?: unknown; rules_version?: unknown };
        return typeof h.engine_api === "number" && typeof h.rules_version === "string";
      } catch {
        return false;
      }
    });

    const appEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: db.url,
      ENGINE_URL: engineUrl,
      ENGINE_SECRET: engineSecret,
      AUTH_SECRET: authSecret,
      AUTH_URL: webUrl,
      APP_URL: webUrl,
      MICROTRACE_VAR_DIR: varDir,
      NEXT_DIST_DIR: E2E_DIST_DIR,
      NEXT_TELEMETRY_DISABLED: "1",
    };

    // Données de départ : uniquement par les services (compte, laboratoire, appartenance).
    const stateFile = path.join(work, "state.json");
    execFileSync(
      process.execPath,
      [
        path.join("node_modules", "tsx", "dist", "cli.mjs"),
        "--conditions=react-server",
        path.join("e2e", "seed.ts"),
      ],
      { cwd: WEB_DIR, env: { ...appEnv, E2E_PASSWORD: password, E2E_STATE_FILE: stateFile }, stdio: "inherit" },
    );

    execFileSync(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "build"], {
      cwd: WEB_DIR,
      env: appEnv,
      stdio: "inherit",
    });

    web = spawnLogged(
      process.execPath,
      [
        path.join("node_modules", "next", "dist", "bin", "next"),
        "start",
        "-p",
        String(webPort),
        "-H",
        "127.0.0.1",
      ],
      appEnv,
      WEB_DIR,
      path.join(work, "web.log"),
    );
    await waitForHttp(`${webUrl}/connexion`, "L'application", 90_000, () => web?.exitCode === null, (body) => body.includes("Prototype de recherche, pas un dispositif médical"));

    process.env.E2E_BASE_URL = webUrl;
    process.env.E2E_DATABASE_URL = db.url;
    process.env.E2E_PASSWORD = password;
    process.env.E2E_STATE_FILE = stateFile;
    return teardown;
  } catch (e) {
    for (const f of ["engine.log", "web.log"]) printLogTail(path.join(work, f), secrets);
    await teardown();
    throw e;
  }
}
