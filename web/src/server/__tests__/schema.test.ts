import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
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
  const project = await prisma.project.create({
    data: { title: "P", description: "", ownerId: user.id },
  });
  const study = await prisma.study.create({
    data: { projectId: project.id, title: "E", nature: "simulated" },
  });
  return { user, project, study };
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
    ["Matrix", Matrix, rec.matrix.enum],
    ["DetectionStatus", DetectionStatus, rec.status.enum],
    ["RecordType", RecordType, rec.record_type.enum],
    ["IdentificationStatus", IdentificationStatus, rec.identification_status.enum],
  ])("%s", (_n, prismaEnum, engine) => {
    expect(sorted(prismaEnum)).toEqual([...(engine as string[])].sort());
  });
});
