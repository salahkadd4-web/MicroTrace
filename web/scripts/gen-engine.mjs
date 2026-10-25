// Génère les types du moteur depuis engine/openapi.json (contrat committé).
// Usage : node scripts/gen-engine.mjs [fichier-de-sortie]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(root, "../engine/openapi.json");
const output = resolve(process.argv[2] ?? resolve(root, "src/server/engine/schema.d.ts"));

const ast = await openapiTS(pathToFileURL(input));
const banner = "// Fichier généré par `npm run gen:engine` depuis engine/openapi.json. Ne pas modifier.\n\n";
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, banner + astToString(ast), "utf8");
