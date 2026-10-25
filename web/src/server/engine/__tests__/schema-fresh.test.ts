import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("schema.d.ts correspond à engine/openapi.json (lancer npm run gen:engine)", () => {
  const dir = mkdtempSync(join(tmpdir(), "engine-schema-"));
  try {
    const out = join(dir, "schema.d.ts");
    execFileSync(process.execPath, ["scripts/gen-engine.mjs", out], { stdio: "pipe" });
    const fresh = readFileSync(out, "utf8");
    const committed = readFileSync("src/server/engine/schema.d.ts", "utf8");
    expect(committed.replace(/\r\n/g, "\n")).toBe(fresh.replace(/\r\n/g, "\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
