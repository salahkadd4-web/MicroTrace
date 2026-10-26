-- CreateEnum
CREATE TYPE "LabRole" AS ENUM ('lab_admin', 'researcher', 'viewer');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "laboratoryId" TEXT;

-- CreateTable
CREATE TABLE "Laboratory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),

    CONSTRAINT "Laboratory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "laboratoryId" TEXT NOT NULL,
    "role" "LabRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "laboratoryId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "LabRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Laboratory_slug_key" ON "Laboratory"("slug");

-- CreateIndex
CREATE INDEX "Membership_laboratoryId_idx" ON "Membership"("laboratoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_laboratoryId_key" ON "Membership"("userId", "laboratoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_laboratoryId_idx" ON "Invitation"("laboratoryId");

-- CreateIndex
CREATE INDEX "AuditEvent_laboratoryId_idx" ON "AuditEvent"("laboratoryId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rattachement des données existantes (spec §11) : Project.laboratoryId et
-- Study.laboratoryId sont d'abord facultatives, remplies, puis rendues obligatoires.
ALTER TABLE "Project" ADD COLUMN "laboratoryId" TEXT;
ALTER TABLE "Study" ADD COLUMN "laboratoryId" TEXT;

-- Le laboratoire par défaut n'est créé que si des projets existent.
INSERT INTO "Laboratory" ("id", "name", "slug")
SELECT gen_random_uuid()::text, 'Laboratoire par défaut', 'labo-par-defaut'
WHERE EXISTS (SELECT 1 FROM "Project");

UPDATE "Project" SET "laboratoryId" = (SELECT "id" FROM "Laboratory" WHERE "slug" = 'labo-par-defaut');
UPDATE "Study" SET "laboratoryId" = (SELECT "id" FROM "Laboratory" WHERE "slug" = 'labo-par-defaut');

-- Chaque utilisateur existant devient responsable du laboratoire par défaut.
INSERT INTO "Membership" ("id", "userId", "laboratoryId", "role")
SELECT gen_random_uuid()::text, u."id", l."id", 'lab_admin'
FROM "User" u CROSS JOIN "Laboratory" l
WHERE l."slug" = 'labo-par-defaut';

-- Les événements métier existants portent le laboratoire par défaut. Le déclencheur
-- d'ajout seul est suspendu le temps de cette seule mise à jour de rattachement.
ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_event_append_only;
UPDATE "AuditEvent"
SET "laboratoryId" = (SELECT "id" FROM "Laboratory" WHERE "slug" = 'labo-par-defaut')
WHERE "entityType" <> 'User'
  AND EXISTS (SELECT 1 FROM "Laboratory" WHERE "slug" = 'labo-par-defaut');
ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_event_append_only;

ALTER TABLE "Project" ALTER COLUMN "laboratoryId" SET NOT NULL;
ALTER TABLE "Study" ALTER COLUMN "laboratoryId" SET NOT NULL;

ALTER TABLE "Project" ADD CONSTRAINT "Project_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Study" ADD CONSTRAINT "Study_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Project_laboratoryId_idx" ON "Project"("laboratoryId");
CREATE INDEX "Study_laboratoryId_idx" ON "Study"("laboratoryId");
