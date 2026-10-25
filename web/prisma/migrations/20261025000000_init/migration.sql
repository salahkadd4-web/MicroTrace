-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DataNature" AS ENUM ('published', 'laboratory', 'simulated');

-- CreateEnum
CREATE TYPE "BlankCorrected" AS ENUM ('yes', 'no', 'unknown');

-- CreateEnum
CREATE TYPE "Technique" AS ENUM ('py_gc_ms', 'ted_gc_ms', 'micro_ftir', 'micro_raman', 'other');

-- CreateEnum
CREATE TYPE "Matrix" AS ENUM ('whole_blood', 'plasma', 'serum', 'other');

-- CreateEnum
CREATE TYPE "RecordType" AS ENUM ('sample', 'procedural_blank', 'field_blank', 'spiked');

-- CreateEnum
CREATE TYPE "DetectionStatus" AS ENUM ('quantified', 'between_lod_loq', 'not_quantified', 'below_lod', 'not_analysed');

-- CreateEnum
CREATE TYPE "IdentificationStatus" AS ENUM ('confirmed', 'candidate');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "PredictionKind" AS ENUM ('spectral', 'image', 'quality');

-- CreateEnum
CREATE TYPE "PredictionStatus" AS ENUM ('proposed', 'accepted', 'corrected', 'rejected');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Study" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "nature" "DataNature" NOT NULL,
    "referenceDoi" TEXT,
    "referenceLicense" TEXT,
    "blankCorrected" "BlankCorrected" NOT NULL DEFAULT 'unknown',
    "pseudonymDeclaredAt" TIMESTAMP(3),
    "pseudonymDeclaredById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Study_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Method" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "technique" "Technique" NOT NULL,

    CONSTRAINT "Method_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectionLimit" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "polymer" TEXT NOT NULL,
    "lod" DOUBLE PRECISION,
    "loq" DOUBLE PRECISION,
    "unitCode" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "DetectionLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityControlSummary" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "polymer" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "mean" DOUBLE PRECISION,
    "sd" DOUBLE PRECISION,
    "unitCode" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "QualityControlSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataFile" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "dataFileId" TEXT NOT NULL,
    "sheet" TEXT,
    "mapping" JSONB NOT NULL,
    "frozenContext" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "issues" JSONB NOT NULL,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "infoCount" INTEGER NOT NULL DEFAULT 0,
    "warningsAccepted" BOOLEAN NOT NULL DEFAULT false,
    "warningsAcceptedAt" TIMESTAMP(3),
    "warningsAcceptedById" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'active',
    "retiredReason" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "importRunId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "aliquot" TEXT NOT NULL,
    "recordType" "RecordType" NOT NULL,
    "matrix" "Matrix" NOT NULL,
    "matrixDetail" TEXT NOT NULL,
    "polymer" TEXT NOT NULL,
    "polymerRaw" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "technique" "Technique" NOT NULL,
    "reportedValue" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unitCode" TEXT NOT NULL,
    "canonicalValue" DOUBLE PRECISION,
    "canonicalUnitCode" TEXT NOT NULL,
    "status" "DetectionStatus" NOT NULL,
    "lod" DOUBLE PRECISION,
    "loq" DOUBLE PRECISION,
    "canonicalLod" DOUBLE PRECISION,
    "canonicalLoq" DOUBLE PRECISION,
    "identificationStatus" "IdentificationStatus" NOT NULL,
    "sizeMinUm" DOUBLE PRECISION,
    "sizeMaxUm" DOUBLE PRECISION,
    "analysisDate" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "lab" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "sourceColumn" TEXT NOT NULL,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcMeasurement" (
    "id" TEXT NOT NULL,
    "importRunId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "aliquot" TEXT NOT NULL,
    "recordType" "RecordType" NOT NULL,
    "matrix" "Matrix" NOT NULL,
    "matrixDetail" TEXT NOT NULL,
    "polymer" TEXT NOT NULL,
    "polymerRaw" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "technique" "Technique" NOT NULL,
    "reportedValue" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unitCode" TEXT NOT NULL,
    "canonicalValue" DOUBLE PRECISION,
    "canonicalUnitCode" TEXT NOT NULL,
    "status" "DetectionStatus" NOT NULL,
    "lod" DOUBLE PRECISION,
    "loq" DOUBLE PRECISION,
    "canonicalLod" DOUBLE PRECISION,
    "canonicalLoq" DOUBLE PRECISION,
    "identificationStatus" "IdentificationStatus" NOT NULL,
    "sizeMinUm" DOUBLE PRECISION,
    "sizeMaxUm" DOUBLE PRECISION,
    "analysisDate" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "lab" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "sourceColumn" TEXT NOT NULL,

    CONSTRAINT "QcMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPrediction" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "kind" "PredictionKind" NOT NULL,
    "inputFileSha256" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "score" DOUBLE PRECISION,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "modelSha256" TEXT,
    "status" "PredictionStatus" NOT NULL DEFAULT 'proposed',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Method_studyId_nameKey_key" ON "Method"("studyId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "DetectionLimit_studyId_methodId_polymer_key" ON "DetectionLimit"("studyId", "methodId", "polymer");

-- CreateIndex
CREATE INDEX "DataFile_studyId_sha256_idx" ON "DataFile"("studyId", "sha256");

-- CreateIndex
CREATE INDEX "Measurement_studyId_idx" ON "Measurement"("studyId");

-- CreateIndex
CREATE INDEX "Measurement_importRunId_idx" ON "Measurement"("importRunId");

-- CreateIndex
CREATE INDEX "QcMeasurement_studyId_idx" ON "QcMeasurement"("studyId");

-- CreateIndex
CREATE INDEX "QcMeasurement_importRunId_idx" ON "QcMeasurement"("importRunId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Study" ADD CONSTRAINT "Study_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Method" ADD CONSTRAINT "Method_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionLimit" ADD CONSTRAINT "DetectionLimit_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionLimit" ADD CONSTRAINT "DetectionLimit_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "Method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityControlSummary" ADD CONSTRAINT "QualityControlSummary_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataFile" ADD CONSTRAINT "DataFile_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_dataFileId_fkey" FOREIGN KEY ("dataFileId") REFERENCES "DataFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcMeasurement" ADD CONSTRAINT "QcMeasurement_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

