import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteStaging,
  discardStagingFor,
  purgeStaging,
  putStaging,
  readStaging,
  readStoredFile,
  storeFile,
  varDir,
} from "@/server/file-store";

const GONE = "Dépôt introuvable ou expiré.";
const dir = mkdtempSync(path.join(tmpdir(), "mt-var-"));
process.env.MICROTRACE_VAR_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  rmSync(path.join(dir, "staging"), { recursive: true, force: true });
  rmSync(path.join(dir, "files"), { recursive: true, force: true });
});

const owner = { userId: "u1", laboratoryId: "l1", studyId: "s1" };
const bytes = new TextEncoder().encode("a,b\n1,2\n");
const file = { name: "résultats.csv", type: "text/csv", bytes };
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("varDir", () => {
  it("lit MICROTRACE_VAR_DIR, sinon ../var du dossier de travail", () => {
    expect(varDir()).toBe(path.resolve(dir));
    const saved = process.env.MICROTRACE_VAR_DIR;
    delete process.env.MICROTRACE_VAR_DIR;
    expect(varDir()).toBe(path.resolve(process.cwd(), "..", "var"));
    process.env.MICROTRACE_VAR_DIR = saved;
  });
});

describe("zone de dépôt", () => {
  it("aller-retour d'un dépôt", async () => {
    const put = await putStaging(owner, file);
    expect(put.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(put.sha256).toBe(sha(bytes));
    expect(put.size).toBe(bytes.length);
    const got = await readStaging(owner, put.token);
    expect(got.name).toBe("résultats.csv");
    expect(got.type).toBe("text/csv");
    expect(got.sha256).toBe(put.sha256);
    expect(Buffer.from(got.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it("les métadonnées ne contiennent pas le contenu du fichier", async () => {
    const put = await putStaging(owner, file);
    const meta = readFileSync(
      path.join(dir, "staging", `${put.token}.json`),
      "utf8",
    );
    expect(meta).not.toContain("a,b");
    expect(meta).toContain("createdAt");
  });

  it.each([
    ["autre utilisateur", { ...owner, userId: "u2" }],
    ["autre laboratoire", { ...owner, laboratoryId: "l2" }],
    ["autre étude", { ...owner, studyId: "s2" }],
  ])("%s : introuvable", async (_n, other) => {
    const put = await putStaging(owner, file);
    await expect(readStaging(other, put.token)).rejects.toThrow(GONE);
  });

  it("jeton mal formé ou inconnu : introuvable, sans toucher au disque hors zone", async () => {
    await expect(readStaging(owner, "../../etc/passwd")).rejects.toThrow(GONE);
    await expect(readStaging(owner, "court")).rejects.toThrow(GONE);
    await expect(readStaging(owner, "A".repeat(43))).rejects.toThrow(GONE);
  });

  it("dépôt de plus de 24 h : introuvable", async () => {
    const put = await putStaging(owner, file);
    const metaPath = path.join(dir, "staging", `${put.token}.json`);
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.createdAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    writeFileSync(metaPath, JSON.stringify(meta));
    await expect(readStaging(owner, put.token)).rejects.toThrow(GONE);
  });

  it("octets altérés : introuvable (sha256 recalculé)", async () => {
    const put = await putStaging(owner, file);
    writeFileSync(path.join(dir, "staging", `${put.token}.bin`), "autre chose");
    await expect(readStaging(owner, put.token)).rejects.toThrow(GONE);
  });

  it("octets supprimés après lecture des métadonnées : introuvable", async () => {
    const put = await putStaging(owner, file);
    rmSync(path.join(dir, "staging", `${put.token}.bin`));
    await expect(readStaging(owner, put.token)).rejects.toThrow(GONE);
  });

  it("discardStagingFor : efface son dépôt, refuse celui d'un autre, ignore un dépôt absent", async () => {
    const put = await putStaging(owner, file);
    await expect(discardStagingFor({ ...owner, userId: "u2" }, put.token)).rejects.toThrow(GONE);
    expect(readdirSync(path.join(dir, "staging"))).toHaveLength(2);
    await discardStagingFor(owner, put.token);
    expect(readdirSync(path.join(dir, "staging"))).toEqual([]);
    await expect(discardStagingFor(owner, put.token)).resolves.toBeUndefined();
    await expect(discardStagingFor(owner, "court")).resolves.toBeUndefined();
  });

  it("deleteStaging supprime les deux fichiers", async () => {
    const put = await putStaging(owner, file);
    await deleteStaging(put.token);
    expect(readdirSync(path.join(dir, "staging"))).toEqual([]);
    await expect(deleteStaging(put.token)).resolves.toBeUndefined();
  });

  it("la purge supprime seulement les dépôts expirés", async () => {
    const old = await putStaging(owner, file);
    const fresh = await putStaging(owner, file);
    const metaPath = path.join(dir, "staging", `${old.token}.json`);
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.createdAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    writeFileSync(metaPath, JSON.stringify(meta));
    await purgeStaging();
    expect(existsSync(path.join(dir, "staging", `${old.token}.bin`))).toBe(
      false,
    );
    expect(existsSync(metaPath)).toBe(false);
    await expect(readStaging(owner, fresh.token)).resolves.toBeTruthy();
  });

  it("putStaging purge au passage les dépôts expirés", async () => {
    const old = await putStaging(owner, file);
    const metaPath = path.join(dir, "staging", `${old.token}.json`);
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.createdAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    writeFileSync(metaPath, JSON.stringify(meta));
    await putStaging(owner, file);
    expect(existsSync(metaPath)).toBe(false);
  });
});

describe("storeFile", () => {
  it("écrit files/<sha256>, idempotent, sans fichier temporaire", async () => {
    const h = sha(bytes);
    expect(await storeFile(h, bytes)).toBe(`files/${h}`);
    const target = path.join(dir, "files", h);
    const past = new Date(Date.now() - 3600_000);
    utimesSync(target, past, past);
    const before = readFileSync(target);
    expect(await storeFile(h, bytes)).toBe(`files/${h}`);
    expect(Buffer.from(before).equals(readFileSync(target))).toBe(true);
    expect(readdirSync(path.join(dir, "files"))).toEqual([h]);
  });

  it("deux écritures concurrentes du même contenu réussissent, sans résidu", async () => {
    const big = new Uint8Array(4 * 1024 * 1024).map((_, i) => (i * 7) & 255);
    const h = sha(big);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => storeFile(h, big)),
    );
    expect(results).toEqual(Array(6).fill(`files/${h}`));
    expect(readdirSync(path.join(dir, "files"))).toEqual([h]);
    expect(sha(readFileSync(path.join(dir, "files", h)))).toBe(h);
  });

  it("refuse un sha256 mal formé ou qui ne correspond pas aux octets", async () => {
    await expect(storeFile("../x", bytes)).rejects.toThrow();
    await expect(storeFile("A".repeat(64), bytes)).rejects.toThrow();
    await expect(storeFile("0".repeat(64), bytes)).rejects.toThrow();
  });

  it("ne réécrit jamais un fichier existant dont le contenu diffère", async () => {
    const h = sha(bytes);
    await storeFile(h, bytes);
    writeFileSync(path.join(dir, "files", h), "corrompu");
    await expect(storeFile(h, bytes)).rejects.toThrow();
    expect(readFileSync(path.join(dir, "files", h), "utf8")).toBe("corrompu");
  });
});

describe("readStoredFile", () => {
  it("renvoie les octets du magasin", async () => {
    const h = sha(bytes);
    await storeFile(h, bytes);
    expect(Buffer.from((await readStoredFile(h))!).equals(Buffer.from(bytes))).toBe(true);
  });
  it("renvoie null pour un fichier absent", async () => {
    expect(await readStoredFile(sha(new Uint8Array([9, 9])))).toBeNull();
  });
  it("lève une erreur si le contenu a été altéré", async () => {
    const h = sha(bytes);
    await storeFile(h, bytes);
    writeFileSync(path.join(dir, "files", h), "altéré");
    await expect(readStoredFile(h)).rejects.toThrow();
  });
  it("refuse un sha256 mal formé", async () => {
    await expect(readStoredFile("../x")).rejects.toThrow();
  });
});
