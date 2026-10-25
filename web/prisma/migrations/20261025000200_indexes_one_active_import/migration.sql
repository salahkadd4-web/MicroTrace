-- DropIndex
DROP INDEX "DataFile_studyId_sha256_idx";

-- CreateIndex
CREATE INDEX "Study_projectId_idx" ON "Study"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DataFile_studyId_sha256_key" ON "DataFile"("studyId", "sha256");

-- CreateIndex
CREATE INDEX "ImportRun_studyId_status_idx" ON "ImportRun"("studyId", "status");

-- CreateIndex
CREATE INDEX "ImportRun_dataFileId_idx" ON "ImportRun"("dataFileId");

-- CreateIndex
CREATE INDEX "ModelPrediction_studyId_idx" ON "ModelPrediction"("studyId");

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcMeasurement" ADD CONSTRAINT "QcMeasurement_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "Study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Un seul import actif par fichier et par étude (règle de la spec §4).
CREATE UNIQUE INDEX "ImportRun_one_active_per_file"
ON "ImportRun"("studyId", "dataFileId") WHERE status = 'active';
