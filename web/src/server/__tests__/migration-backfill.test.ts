import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "../../../test/db-start";

/**
 * Rejoue les migrations pas à pas sur des bases embarquées vierges (jamais le PostgreSQL local) :
 * les fichiers `migration.sql` sont appliqués dans l'ordre avec un client `pg`, en insérant des
 * données entre la migration 20261025000200 et la suivante (même effet que `migrate deploy`).
 */
const DIR = join(process.cwd(), "prisma", "migrations");
const MIGRATIONS = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const LAST_OLD = MIGRATIONS.findIndex((m) => m.startsWith("20261025000200_"));
const sql = (name: string) => readFileSync(join(DIR, name, "migration.sql"), "utf8");

let db: TestDb | undefined;
let client: pg.Client | undefined;

afterEach(async () => {
  await client?.end();
  await db?.stop();
  client = undefined;
  db = undefined;
});

async function freshDb(): Promise<pg.Client> {
  db = await startTestDb({ migrate: false });
  client = new pg.Client({ connectionString: db.url });
  await client.connect();
  return client;
}

async function applyUpTo(c: pg.Client, lastIndex: number) {
  for (const name of MIGRATIONS.slice(0, lastIndex + 1)) await c.query(sql(name));
}

describe("migration multi_lab : rattachement des données existantes", () => {
  it("les migrations attendues existent dans l'ordre", () => {
    expect(LAST_OLD).toBeGreaterThanOrEqual(0);
    const rest = MIGRATIONS.slice(LAST_OLD + 1);
    expect(rest[0]).toBe("20261026000000_multi_lab");
    expect(rest[1]).toBe("20261026000100_lab_invariants");
  });

  it("avec des projets : laboratoire par défaut, rattachements, responsables, déclencheur rétabli", async () => {
    const c = await freshDb();
    await applyUpTo(c, LAST_OLD);
    await c.query(`
      INSERT INTO "User" (id, name, email, "passwordHash") VALUES
        ('u1', 'A', 'a@example.org', 'h'), ('u2', 'B', 'b@example.org', 'h');
      INSERT INTO "Project" (id, title, "ownerId") VALUES ('p1', 'P', 'u1');
      INSERT INTO "Study" (id, "projectId", title, nature) VALUES ('s1', 'p1', 'E', 'simulated');
      INSERT INTO "Method" (id, "studyId", name, "nameKey", technique)
        VALUES ('m1', 's1', 'M', 'm', 'other');
      INSERT INTO "AuditEvent" (id, action, "entityType", "entityId") VALUES
        ('e1', 'project.create', 'Project', 'p1'),
        ('e2', 'study.method.add', 'Method', 'm1'),
        ('e3', 'user.create', 'User', 'u1');`);
    for (const name of MIGRATIONS.slice(LAST_OLD + 1)) await c.query(sql(name));

    const labs = (await c.query(`SELECT id, name, slug, "suspendedAt" FROM "Laboratory"`)).rows;
    expect(labs).toHaveLength(1);
    expect(labs[0]).toMatchObject({
      name: "Laboratoire par défaut",
      slug: "labo-par-defaut",
      suspendedAt: null,
    });
    const labId = labs[0].id;
    expect((await c.query(`SELECT "laboratoryId" FROM "Project"`)).rows).toEqual([
      { laboratoryId: labId },
    ]);
    expect((await c.query(`SELECT "laboratoryId" FROM "Study"`)).rows).toEqual([
      { laboratoryId: labId },
    ]);
    const audits = (await c.query(`SELECT id, "laboratoryId" FROM "AuditEvent" ORDER BY id`)).rows;
    expect(audits).toEqual([
      { id: "e1", laboratoryId: labId },
      { id: "e2", laboratoryId: labId },
      { id: "e3", laboratoryId: null },
    ]);
    const members = (
      await c.query(`SELECT "userId", role, "laboratoryId" FROM "Membership" ORDER BY "userId"`)
    ).rows;
    expect(members).toEqual([
      { userId: "u1", role: "lab_admin", laboratoryId: labId },
      { userId: "u2", role: "lab_admin", laboratoryId: labId },
    ]);

    // Le déclencheur d'ajout seul est de nouveau actif.
    const trigger = await c.query(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'audit_event_append_only'`,
    );
    expect(trigger.rows).toEqual([{ tgenabled: "O" }]);
    await expect(c.query(`UPDATE "AuditEvent" SET action = 'x'`)).rejects.toThrow(/ajout seul/);
    await expect(c.query(`DELETE FROM "AuditEvent"`)).rejects.toThrow(/ajout seul/);
  }, 120000);

  it("sans projet : aucun laboratoire par défaut, aucune appartenance", async () => {
    const c = await freshDb();
    await applyUpTo(c, LAST_OLD);
    await c.query(`INSERT INTO "User" (id, name, email, "passwordHash")
                   VALUES ('u1', 'A', 'a@example.org', 'h')`);
    for (const name of MIGRATIONS.slice(LAST_OLD + 1)) await c.query(sql(name));
    expect((await c.query(`SELECT count(*)::int AS n FROM "Laboratory"`)).rows[0].n).toBe(0);
    expect((await c.query(`SELECT count(*)::int AS n FROM "Membership"`)).rows[0].n).toBe(0);
  }, 120000);
});
