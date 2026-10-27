-- Invariants d'étude en base : un enregistrement dépendant (mesure, contrôle qualité, import,
-- limite de détection) reste dans la même étude que son parent (clés étrangères composites).
-- Les tables d'étude sont vides à ce stade (le téléversement arrive en C3) : aucune reprise de données.
-- L'index partiel ImportRun_one_active_per_file et le déclencheur d'audit ne sont pas touchés.

-- DropForeignKey
ALTER TABLE "DetectionLimit" DROP CONSTRAINT "DetectionLimit_methodId_fkey";
ALTER TABLE "ImportRun" DROP CONSTRAINT "ImportRun_dataFileId_fkey";
ALTER TABLE "Measurement" DROP CONSTRAINT "Measurement_importRunId_fkey";
ALTER TABLE "QcMeasurement" DROP CONSTRAINT "QcMeasurement_importRunId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Method_id_studyId_key" ON "Method"("id", "studyId");
CREATE UNIQUE INDEX "DataFile_id_studyId_key" ON "DataFile"("id", "studyId");
CREATE UNIQUE INDEX "ImportRun_id_studyId_key" ON "ImportRun"("id", "studyId");

-- AddForeignKey
ALTER TABLE "DetectionLimit" ADD CONSTRAINT "DetectionLimit_methodId_studyId_fkey" FOREIGN KEY ("methodId", "studyId") REFERENCES "Method"("id", "studyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_dataFileId_studyId_fkey" FOREIGN KEY ("dataFileId", "studyId") REFERENCES "DataFile"("id", "studyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_importRunId_studyId_fkey" FOREIGN KEY ("importRunId", "studyId") REFERENCES "ImportRun"("id", "studyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QcMeasurement" ADD CONSTRAINT "QcMeasurement_importRunId_studyId_fkey" FOREIGN KEY ("importRunId", "studyId") REFERENCES "ImportRun"("id", "studyId") ON DELETE RESTRICT ON UPDATE CASCADE;
