#!/usr/bin/env node
// Crée le fichier .env à la racine à partir de .env.example, avec des secrets aléatoires.
// Usage : node scripts/generate-secrets.mjs [--force]
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, ".env");
const force = process.argv.includes("--force");

if (existsSync(target) && !force) {
  console.error(".env existe déjà : rien n'a été modifié. Utilisez --force pour le remplacer.");
  process.exit(1);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function secret(length = 48) {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return out;
}

const generated = {
  POSTGRES_PASSWORD: secret(),
  ENGINE_SECRET: secret(),
  AUTH_SECRET: secret(),
};
const lines = readFileSync(join(root, ".env.example"), "utf8")
  .split(/\r?\n/)
  .map((line) => {
    const m = /^([A-Z_]+)=/.exec(line);
    return m && m[1] in generated ? `${m[1]}=${generated[m[1]]}` : line;
  });
writeFileSync(target, lines.join("\n"), { mode: 0o600 });
console.log("Fichier .env créé (secrets aléatoires générés). Ne le partagez jamais.");
