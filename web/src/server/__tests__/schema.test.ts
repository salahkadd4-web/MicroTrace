import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BlankCorrected,
  DataNature,
  DetectionStatus,
  IdentificationStatus,
  Matrix,
  RecordType,
  Technique,
} from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { resetDb } from "../../../test/db-reset";

async function makeStudy() {
  const user = await prisma.user.create({
    data: { name: "Test", email: "t@example.org", passwordHash: "x" },
  });
  const lab = await prisma.laboratory.create({ data: { name: "Labo", slug: "labo" } });
  const project = await prisma.project.create({
    data: { title: "P", description: "", ownerId: user.id, laboratoryId: lab.id },
  });
  const study = await prisma.study.create({
    data: { projectId: project.id, laboratoryId: lab.id, title: "E", nature: "simulated" },
  });
  return { user, lab, project, study };
}

beforeEach(async () => {
  await resetDb();
});

describe("journal d'audit en ajout seul", () => {
  it("refuse UPDATE", async () => {
    const ev = await prisma.auditEvent.create({
      data: { action: "a", entityType: "Study", entityId: "1" },
    });
    await expect(
      prisma.auditEvent.update({ where: { id: ev.id }, data: { action: "b" } }),
    ).rejects.toThrow(/ajout seul/);
  });

  it("refuse DELETE", async () => {
    const ev = await prisma.auditEvent.create({
      data: { action: "a", entityType: "Study", entityId: "1" },
    });
    await expect(
      prisma.auditEvent.delete({ where: { id: ev.id } }),
    ).rejects.toThrow(/ajout seul/);
  });

  it("permet TRUNCATE", async () => {
    await prisma.auditEvent.create({
      data: { action: "a", entityType: "Study", entityId: "1" },
    });
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditEvent"');
    expect(await prisma.auditEvent.count()).toBe(0);
  });
});

const MSG =
  /Le journal d'audit est en ajout seul : (UPDATE|DELETE) interdit sur AuditEvent\./;

describe("garde-fou : index partiel", () => {
  it("ImportRun_one_active_per_file existe avec son WHERE", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'ImportRun_one_active_per_file'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("WHERE (status = 'active'");
  });
});

describe("déclencheur : message exact", () => {
  it.each(["UPDATE", "DELETE"] as const)("%s", async (op) => {
    await prisma.auditEvent.create({
      data: { action: "a", entityType: "Study", entityId: "1" },
    });
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const sql =
        op === "UPDATE"
          ? `UPDATE "AuditEvent" SET action = 'x'`
          : `DELETE FROM "AuditEvent"`;
      await expect(client.query(sql)).rejects.toMatchObject({
        message: `Le journal d'audit est en ajout seul : ${op} interdit sur AuditEvent.`,
      });
    } finally {
      await client.end();
    }
  });
});

describe("déclencheur : autres chemins d'écriture", () => {
  async function ev() {
    return prisma.auditEvent.create({
      data: { action: "a", entityType: "Study", entityId: "1" },
    });
  }
  it("updateMany et deleteMany", async () => {
    await ev();
    await expect(
      prisma.auditEvent.updateMany({ data: { action: "b" } }),
    ).rejects.toThrow(MSG);
    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow(MSG);
  });
  it("SQL brut UPDATE et DELETE, message complet", async () => {
    await ev();
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET action = 'x'`),
    ).rejects.toThrow(
      "Le journal d'audit est en ajout seul : UPDATE interdit sur AuditEvent.",
    );
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "AuditEvent"`),
    ).rejects.toThrow(
      "Le journal d'audit est en ajout seul : DELETE interdit sur AuditEvent.",
    );
    expect(await prisma.auditEvent.count()).toBe(1);
  });
});

describe("intégrité référentielle et import actif", () => {
  it("suppression d'une étude ou d'un projet avec enfants refusée", async () => {
    const { study, project, lab } = await makeStudy();
    await expect(
      prisma.study.delete({ where: { id: study.id } }),
    ).resolves.toBeDefined(); // sans enfant : possible en base
    const s2 = await prisma.study.create({
      data: { projectId: project.id, laboratoryId: lab.id, title: "E2", nature: "simulated" },
    });
    await prisma.method.create({
      data: { studyId: s2.id, name: "M", nameKey: "m", technique: "other" },
    });
    await expect(
      prisma.study.delete({ where: { id: s2.id } }),
    ).rejects.toThrow(/foreign key|Foreign key/i);
    await expect(
      prisma.project.delete({ where: { id: project.id } }),
    ).rejects.toThrow(/foreign key|Foreign key/i);
  });

  it("un seul import actif par fichier et par étude", async () => {
    const { user, study } = await makeStudy();
    const file = await prisma.dataFile.create({
      data: {
        studyId: study.id,
        originalName: "f.csv",
        sha256: "b".repeat(64),
        sizeBytes: 1,
        mimeType: "text/csv",
        storagePath: "x",
        uploadedById: user.id,
      },
    });
    await expect(
      prisma.dataFile.create({
        data: { ...file, id: undefined, originalName: "g.csv" },
      }),
    ).rejects.toThrow(/Unique constraint/);
    const data = {
      studyId: study.id,
      dataFileId: file.id,
      mapping: {},
      frozenContext: {},
      rulesVersion: "1",
      engineVersion: "1",
      issues: [],
      createdById: user.id,
    };
    const first = await prisma.importRun.create({ data });
    await expect(prisma.importRun.create({ data })).rejects.toThrow();
    await prisma.importRun.update({
      where: { id: first.id },
      data: { status: "retired" },
    });
    const second = await prisma.importRun.create({ data });
    expect(second.status).toBe("active");
  });
});

describe("contraintes", () => {
  it("valeurs par défaut d'une étude", async () => {
    const { study } = await makeStudy();
    expect(study.blankCorrected).toBe("unknown");
    expect(study.archivedAt).toBeNull();
    expect(study.pseudonymDeclaredAt).toBeNull();
  });

  it("méthodes de même nameKey : unicité par étude", async () => {
    const { study } = await makeStudy();
    await prisma.method.create({
      data: {
        studyId: study.id,
        name: "Py-GC/MS",
        nameKey: "py-gc/ms",
        technique: "py_gc_ms",
      },
    });
    await expect(
      prisma.method.create({
        data: {
          studyId: study.id,
          name: "py-gc/ms",
          nameKey: "py-gc/ms",
          technique: "py_gc_ms",
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it("limites : unicité (étude, méthode, polymère)", async () => {
    const { study } = await makeStudy();
    const method = await prisma.method.create({
      data: {
        studyId: study.id,
        name: "M",
        nameKey: "m",
        technique: "other",
      },
    });
    const data = {
      studyId: study.id,
      methodId: method.id,
      polymer: "PET",
      lod: 1,
      loq: 2,
      unitCode: "ug/mL",
      source: "test",
    };
    await prisma.detectionLimit.create({ data });
    await expect(prisma.detectionLimit.create({ data })).rejects.toThrow(
      /Unique constraint/,
    );
  });

  it("mesures en double précision", async () => {
    const { user, study } = await makeStudy();
    const file = await prisma.dataFile.create({
      data: {
        studyId: study.id,
        originalName: "f.csv",
        sha256: "a".repeat(64),
        sizeBytes: 1,
        mimeType: "text/csv",
        storagePath: "x",
        uploadedById: user.id,
      },
    });
    const run = await prisma.importRun.create({
      data: {
        studyId: study.id,
        dataFileId: file.id,
        mapping: {},
        frozenContext: {},
        rulesVersion: "1",
        engineVersion: "1",
        issues: [],
        createdById: user.id,
      },
    });
    expect(run.status).toBe("active");
    const m = await prisma.measurement.create({
      data: {
        importRunId: run.id,
        studyId: study.id,
        sampleId: "S1",
        aliquot: "",
        recordType: "sample",
        matrix: "plasma",
        matrixDetail: "",
        polymer: "PET",
        polymerRaw: "pet",
        method: "M",
        technique: "py_gc_ms",
        reportedValue: "0.1",
        value: 0.1234567890123,
        unitCode: "ug/mL",
        canonicalValue: 0.1234567890123,
        canonicalUnitCode: "ug/mL",
        status: "quantified",
        identificationStatus: "confirmed",
        analysisDate: "",
        batch: "",
        lab: "",
        comment: "",
        sourceRow: 2,
        sourceColumn: "c",
      },
    });
    expect(m.value).toBe(0.1234567890123);
  });
});

describe("cohérence des enums avec le moteur", () => {
  const spec = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../../engine/openapi.json", import.meta.url)),
      "utf8",
    ),
  );
  const rec = spec.components.schemas.MeasurementRecordModel.properties;
  const ctx = spec.components.schemas.StudyContextModel.properties;
  const sorted = (o: object) => Object.values(o).sort();

  it.each([
    ["Technique", Technique, rec.technique.enum],
    ["DataNature", DataNature, ctx.data_nature.enum],
    ["BlankCorrected", BlankCorrected, ctx.blank_corrected.enum],
    ["Matrix", Matrix, rec.matrix.enum],
    ["DetectionStatus", DetectionStatus, rec.status.enum],
    ["RecordType", RecordType, rec.record_type.enum],
    ["IdentificationStatus", IdentificationStatus, rec.identification_status.enum],
  ])("%s", (_n, prismaEnum, engine) => {
    expect(sorted(prismaEnum)).toEqual([...(engine as string[])].sort());
  });
});

describe("multi-laboratoires (spec §11)", () => {
  it("laboratoryId est obligatoire sur Project et Study", async () => {
    const { user, project } = await makeStudy();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Project" (id, title, "ownerId") VALUES ('x', 'P', '${user.id}')`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Study" (id, "projectId", title, nature) VALUES ('y', '${project.id}', 'E', 'simulated')`,
      ),
    ).rejects.toThrow();
  });

  it("clés étrangères RESTRICT : un laboratoire avec projets ou membres ne se supprime pas", async () => {
    const { user, lab } = await makeStudy();
    await prisma.membership.create({
      data: { userId: user.id, laboratoryId: lab.id, role: "viewer" },
    });
    await expect(prisma.laboratory.delete({ where: { id: lab.id } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
  });

  it("slug de laboratoire unique ; jeton d'invitation unique ; isPlatformAdmin faux par défaut", async () => {
    const { user, lab } = await makeStudy();
    await expect(
      prisma.laboratory.create({ data: { name: "Autre", slug: "labo" } }),
    ).rejects.toThrow();
    expect(user.isPlatformAdmin).toBe(false);
    const inv = {
      laboratoryId: lab.id,
      email: "x@example.org",
      role: "viewer" as const,
      tokenHash: "h",
      invitedById: user.id,
      expiresAt: new Date(),
    };
    await prisma.invitation.create({ data: inv });
    await expect(prisma.invitation.create({ data: inv })).rejects.toThrow();
  });

  it("une étude ne peut pas citer un laboratoire différent de celui de son projet", async () => {
    const { project } = await makeStudy();
    const other = await prisma.laboratory.create({ data: { name: "Autre", slug: "autre" } });
    await expect(
      prisma.$executeRaw`INSERT INTO "Study" (id, "projectId", "laboratoryId", title, nature)
        VALUES ('mix', ${project.id}, ${other.id}, 'E', 'simulated')`,
    ).rejects.toThrow(/Study_projectId_laboratoryId_fkey|violates foreign key/);
    expect(await prisma.study.count({ where: { id: "mix" } })).toBe(0);
  });

  it("AuditEvent.laboratoryId doit citer un laboratoire existant (RESTRICT)", async () => {
    await expect(
      prisma.auditEvent.create({
        data: { action: "a", entityType: "Study", entityId: "1", laboratoryId: "inexistant" },
      }),
    ).rejects.toThrow();
    const { lab } = await makeStudy();
    await prisma.auditEvent.create({
      data: { action: "a", entityType: "Study", entityId: "1", laboratoryId: lab.id },
    });
    await expect(prisma.laboratory.delete({ where: { id: lab.id } })).rejects.toThrow();
  });

  it("AuditEvent.laboratoryId est facultatif ; index sur laboratoryId", async () => {
    await prisma.auditEvent.create({ data: { action: "a", entityType: "User", entityId: "1" } });
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('Project_laboratoryId_idx', 'Study_laboratoryId_idx',
                          'AuditEvent_laboratoryId_idx', 'Membership_laboratoryId_idx')`;
    expect(rows).toHaveLength(4);
  });
});

describe("invariants d'étude en base (clés étrangères composites)", () => {
  async function twoStudies() {
    const { user, lab, project, study } = await makeStudy();
    const other = await prisma.study.create({
      data: { projectId: project.id, laboratoryId: lab.id, title: "E2", nature: "simulated" },
    });
    return { user, study, other };
  }
  async function fileIn(studyId: string, userId: string, sha = "c".repeat(64)) {
    return prisma.dataFile.create({
      data: {
        studyId,
        originalName: "f.csv",
        sha256: sha,
        sizeBytes: 1,
        mimeType: "text/csv",
        storagePath: "x",
        uploadedById: userId,
      },
    });
  }
  async function runIn(studyId: string, dataFileId: string, userId: string) {
    return prisma.importRun.create({
      data: {
        studyId,
        dataFileId,
        mapping: {},
        frozenContext: {},
        rulesVersion: "1",
        engineVersion: "1",
        issues: [],
        createdById: userId,
      },
    });
  }
  const FK = /foreign key|Foreign key/i;
  const rowSql = (table: "Measurement" | "QcMeasurement") => `
    INSERT INTO "${table}" (id, "importRunId", "studyId", "sampleId", aliquot, "recordType", matrix,
      "matrixDetail", polymer, "polymerRaw", method, technique, "reportedValue", "unitCode",
      "canonicalUnitCode", status, "identificationStatus", "analysisDate", batch, lab, comment,
      "sourceRow", "sourceColumn")
    VALUES ('x1', $1, $2, 's', '', 'sample', 'plasma', '', 'PE', 'PE', 'm', 'other', '1', 'u',
      'u', 'quantified', 'confirmed', '', '', '', '', 1, 'A')`;

  it.each(["Measurement", "QcMeasurement"] as const)(
    "%s : importRun d'une autre étude refusé, même étude accepté",
    async (table) => {
      const { user, study, other } = await twoStudies();
      const run = await runIn(study.id, (await fileIn(study.id, user.id)).id, user.id);
      await expect(prisma.$executeRawUnsafe(rowSql(table), run.id, other.id)).rejects.toThrow(FK);
      await expect(prisma.$executeRawUnsafe(rowSql(table), run.id, study.id)).resolves.toBe(1);
    },
  );

  it("ImportRun : fichier d'une autre étude refusé", async () => {
    const { user, study, other } = await twoStudies();
    const file = await fileIn(other.id, user.id);
    await expect(runIn(study.id, file.id, user.id)).rejects.toThrow(FK);
    await expect(runIn(other.id, file.id, user.id)).resolves.toBeDefined();
  });

  it("DetectionLimit : méthode d'une autre étude refusée", async () => {
    const { study, other } = await twoStudies();
    const method = await prisma.method.create({
      data: { studyId: other.id, name: "M", nameKey: "m", technique: "other" },
    });
    const data = { methodId: method.id, polymer: "PE", unitCode: "u", source: "s" };
    await expect(
      prisma.detectionLimit.create({ data: { ...data, studyId: study.id } }),
    ).rejects.toThrow(FK);
    await expect(
      prisma.detectionLimit.create({ data: { ...data, studyId: other.id } }),
    ).resolves.toBeDefined();
  });

  it("suppression d'un parent référencé refusée (RESTRICT)", async () => {
    const { user, study } = await twoStudies();
    const file = await fileIn(study.id, user.id);
    await runIn(study.id, file.id, user.id);
    await expect(prisma.dataFile.delete({ where: { id: file.id } })).rejects.toThrow(FK);
  });
});

describe("consentement du laboratoire (C5)", () => {
  it("la contrainte de consentement refuse un état partiel", async () => {
    const lab = await prisma.laboratory.create({ data: { name: "Labo", slug: "labo" } });
    await expect(
      prisma.laboratory.update({ where: { id: lab.id }, data: { trainingConsentAt: new Date() } }),
    ).rejects.toThrow(/Laboratory_training_consent_complete/);
  });

  it("ModelPrediction.createdById cite un utilisateur existant (RESTRICT)", async () => {
    const { user, study } = await makeStudy();
    const data = {
      studyId: study.id, kind: "spectral" as const, input: {}, output: {},
      modelName: "m", modelVersion: "v",
    };
    await expect(
      prisma.modelPrediction.create({ data: { ...data, createdById: "inconnu" } }),
    ).rejects.toThrow();
    const author = await prisma.user.create({
      data: { name: "Auteur", email: "auteur@example.org", passwordHash: "x" },
    });
    const row = await prisma.modelPrediction.create({ data: { ...data, createdById: author.id } });
    await expect(prisma.user.delete({ where: { id: author.id } })).rejects.toThrow(
      /ModelPrediction_createdById_fkey/,
    );
    expect(row.createdById).toBe(author.id);
    expect(user.id).not.toBe(author.id);
  });

  it("aucune dérive entre migrations et schéma", () => {
    // Base embarquée seulement : jamais le service PostgreSQL local (5432).
    const target = new URL(process.env.DATABASE_URL!);
    expect(target.hostname).toBe("127.0.0.1");
    expect(target.port).not.toBe("5432");
    const out = execFileSync(
      process.execPath,
      [
        "node_modules/prisma/build/index.js", "migrate", "diff",
        "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script",
      ],
      { env: process.env, encoding: "utf8" },
    );
    const lines = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("--"));
    expect(lines).toEqual([]);
  });
});
