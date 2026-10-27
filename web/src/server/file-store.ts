import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DomainError } from "@/server/errors";

/** Dépôt temporaire (zone de dépôt) : 24 h. */
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const GONE = "Dépôt introuvable ou expiré.";

export type StagingOwner = {
  userId: string;
  laboratoryId: string;
  studyId: string;
};

type StagingMeta = StagingOwner & {
  name: string;
  type: string;
  sha256: string;
  size: number;
  createdAt: string;
};

/** Répertoire de données : `MICROTRACE_VAR_DIR`, sinon `<dossier web>/../var` (développement). */
export function varDir(): string {
  const configured = process.env.MICROTRACE_VAR_DIR;
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "..", "var");
}

const stagingDir = () => path.join(varDir(), "staging");
const filesDir = () => path.join(varDir(), "files");

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Dépose les octets en zone temporaire. Les métadonnées ne contiennent jamais le contenu. */
export async function putStaging(
  owner: StagingOwner,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<{ token: string; sha256: string; size: number }> {
  await purgeStaging();
  const dir = stagingDir();
  await mkdir(dir, { recursive: true });
  const token = randomBytes(32).toString("base64url");
  const meta: StagingMeta = {
    userId: owner.userId,
    laboratoryId: owner.laboratoryId,
    studyId: owner.studyId,
    name: file.name,
    type: file.type,
    sha256: sha256Of(file.bytes),
    size: file.bytes.length,
    createdAt: new Date().toISOString(),
  };
  await writeFile(path.join(dir, `${token}.bin`), file.bytes);
  await writeFile(path.join(dir, `${token}.json`), JSON.stringify(meta));
  return { token, sha256: meta.sha256, size: meta.size };
}

async function readMeta(token: string): Promise<StagingMeta | null> {
  try {
    return JSON.parse(
      await readFile(path.join(stagingDir(), `${token}.json`), "utf8"),
    );
  } catch {
    return null;
  }
}

export async function readStaging(owner: StagingOwner, token: string) {
  if (!TOKEN_RE.test(token)) throw new DomainError(GONE);
  const meta = await readMeta(token);
  if (
    !meta ||
    meta.userId !== owner.userId ||
    meta.laboratoryId !== owner.laboratoryId ||
    meta.studyId !== owner.studyId ||
    !(Date.parse(meta.createdAt) > Date.now() - STAGING_TTL_MS)
  ) {
    throw new DomainError(GONE);
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(stagingDir(), `${token}.bin`));
  } catch {
    throw new DomainError(GONE);
  }
  if (sha256Of(bytes) !== meta.sha256) throw new DomainError(GONE);
  return {
    bytes,
    name: meta.name,
    type: meta.type,
    sha256: meta.sha256,
    size: meta.size,
  };
}

export async function deleteStaging(token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return;
  await rm(path.join(stagingDir(), `${token}.bin`), { force: true });
  await rm(path.join(stagingDir(), `${token}.json`), { force: true });
}

/** Supprime les dépôts de plus de 24 h (et les octets orphelins de même âge). */
export async function purgeStaging(now: Date = new Date()): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(stagingDir());
  } catch {
    return;
  }
  const cutoff = now.getTime() - STAGING_TTL_MS;
  for (const entry of entries) {
    const m = /^([A-Za-z0-9_-]{43})\.(json|bin)$/.exec(entry);
    if (!m) continue;
    const token = m[1];
    let createdAt: number;
    const meta = m[2] === "json" ? await readMeta(token) : null;
    if (meta) {
      createdAt = Date.parse(meta.createdAt);
    } else if (m[2] === "bin" && (await readMeta(token))) {
      continue; // traité avec son fichier de métadonnées
    } else {
      try {
        createdAt = (await stat(path.join(stagingDir(), entry))).mtimeMs;
      } catch {
        continue;
      }
    }
    if (!(createdAt > cutoff)) await deleteStaging(token);
  }
}

/** Magasin adressé par contenu : écriture atomique, jamais d'écrasement. Renvoie le chemin relatif. */
export async function storeFile(
  sha256: string,
  bytes: Uint8Array,
): Promise<string> {
  if (!SHA_RE.test(sha256)) throw new Error("sha256 invalide.");
  if (sha256Of(bytes) !== sha256)
    throw new Error("Le contenu ne correspond pas au sha256.");
  const dir = filesDir();
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, sha256);
  const relative = `files/${sha256}`;
  let existing: Buffer | null = null;
  try {
    existing = await readFile(target);
  } catch {
    existing = null;
  }
  if (existing) {
    if (sha256Of(existing) !== sha256)
      throw new Error("Fichier du magasin corrompu.");
    return relative;
  }
  const tmp = path.join(dir, `${sha256}.tmp-${randomBytes(8).toString("hex")}`);
  try {
    await writeFile(tmp, bytes);
    try {
      await rename(tmp, target);
    } catch (e) {
      // Écriture concurrente du même contenu (EEXIST/EPERM sous Windows) : le fichier existe peut-être déjà.
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM") throw e;
      const winner = await readFile(target).catch(() => null);
      if (!winner || sha256Of(winner) !== sha256) throw e;
    }
  } finally {
    await rm(tmp, { force: true });
  }
  return relative;
}
