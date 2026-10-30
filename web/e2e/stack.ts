import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export const WEB_DIR = path.resolve(__dirname, "..");
export const REPO_DIR = path.resolve(WEB_DIR, "..");
export const E2E_DIST_DIR = ".next-e2e";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export function randomToken(length: number): string {
  return randomBytes(length).toString("base64url").slice(0, length);
}

export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export function pythonPath(): string {
  const candidates = [
    path.join(REPO_DIR, ".venv", "Scripts", "python.exe"),
    path.join(REPO_DIR, ".venv", "bin", "python"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Interpréteur Python introuvable : créez le .venv à la racine du dépôt.");
  return found;
}

/** Lance un processus ; sa sortie va dans un fichier du dossier temporaire (jamais dans la console). */
export function spawnLogged(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  logFile: string,
): ChildProcess {
  const log = createWriteStream(logFile);
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.once("exit", () => log.end());
  return child;
}

/** Arrête le processus et tous ses descendants. */
export function killTree(child: ChildProcess | undefined): void {
  if (!child || child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    // déjà arrêté
  }
}

/**
 * Interroge l'adresse jusqu'à obtenir une réponse HTTP (statut < 500) que `accept` valide, ou
 * jusqu'au délai. Le contrôle du contenu fait échouer vite un autre processus sur un port réutilisé.
 */
export async function waitForHttp(
  url: string,
  label: string,
  timeoutMs: number,
  isAlive: () => boolean,
  accept: (body: string) => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "aucune réponse";
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error(`${label} s'est arrêté avant d'être prêt.`);
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) {
        if (accept(await res.text())) return;
        last = "réponse inattendue (autre processus sur ce port ?)";
      } else {
        last = `statut ${res.status}`;
      }
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} n'est pas prêt après ${Math.round(timeoutMs / 1000)} s (${last}).`);
}

/** Dernières lignes d'un journal, secrets remplacés par « *** » (écrit sur stderr en cas d'échec). */
export function printLogTail(file: string, secrets: string[], lines = 40): void {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  let tail = text.split(/\r?\n/).slice(-lines).join("\n");
  for (const secret of secrets) if (secret) tail = tail.split(secret).join("***");
  console.error(`--- ${path.basename(file)} (fin) ---\n${tail}`);
}
