-- Consentement du laboratoire à l'amélioration des modèles (C5, conception §10.1) : désactivé par défaut.
ALTER TABLE "Laboratory" ADD COLUMN "trainingConsentAt" TIMESTAMP(3),
  ADD COLUMN "trainingConsentById" TEXT, ADD COLUMN "trainingConsentVersion" TEXT;
ALTER TABLE "Laboratory" ADD CONSTRAINT "Laboratory_training_consent_complete" CHECK (
  ("trainingConsentAt" IS NULL) = ("trainingConsentById" IS NULL)
  AND ("trainingConsentAt" IS NULL) = ("trainingConsentVersion" IS NULL));

-- Auteur de l'analyse spectrale (R-C5-5) : colonne dédiée au lieu de la lecture de l'audit.
ALTER TABLE "ModelPrediction" ADD COLUMN "createdById" TEXT;

-- Rattrapage des analyses existantes depuis l'acteur de leur événement spectral.analysis.
UPDATE "ModelPrediction" p SET "createdById" = e."actorId"
FROM "AuditEvent" e
WHERE e."action" = 'spectral.analysis'
  AND e."entityType" = 'ModelPrediction'
  AND e."entityId" = p."id"
  AND p."kind" = 'spectral'
  AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = e."actorId");

ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
