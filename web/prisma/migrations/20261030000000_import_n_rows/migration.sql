-- Nombre de lignes lues du fichier (distinct du nombre de mesures). Nul pour les imports antérieurs.
ALTER TABLE "ImportRun" ADD COLUMN "nRows" INTEGER;
