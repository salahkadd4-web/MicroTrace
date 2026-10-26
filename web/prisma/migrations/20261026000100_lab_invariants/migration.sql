-- Invariants de laboratoire en base : une étude reste dans le laboratoire de son projet
-- (clé étrangère composite) et un événement d'audit ne peut citer qu'un laboratoire existant.
-- DropForeignKey
ALTER TABLE "Study" DROP CONSTRAINT "Study_projectId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_laboratoryId_key" ON "Project"("id", "laboratoryId");

-- AddForeignKey
ALTER TABLE "Study" ADD CONSTRAINT "Study_projectId_laboratoryId_fkey" FOREIGN KEY ("projectId", "laboratoryId") REFERENCES "Project"("id", "laboratoryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

