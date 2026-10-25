import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetDb } from "./db-reset";

function run(input: string, extra: string[] = ["--email", "Zoe@Example.org", "--name", "Zoé"]) {
  return spawnSync("npm", ["run", "user:create", "--silent", "--", ...extra], {
    input,
    encoding: "utf8",
    shell: true,
    env: { ...process.env },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("user:create", () => {
  it("crée l'utilisateur et l'AuditEvent depuis l'entrée standard", async () => {
    const r = run("mot-de-passe-solide-1\nmot-de-passe-solide-1\n");
    expect(r.status, r.stderr).toBe(0);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "zoe@example.org" } });
    expect(u.name).toBe("Zoé");
    expect(await prisma.auditEvent.count({ where: { action: "user.create" } })).toBe(1);
  }, 60000);

  it("refuse deux mots de passe différents", async () => {
    const r = run("mot-de-passe-solide-1\nautre-mot-de-passe-2\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ne correspondent pas");
    expect(await prisma.user.count()).toBe(0);
  }, 60000);
});
