-- Libro 1.17.0 · blindaje de secuencia, auditoría y error humano

CREATE TYPE "ChecklistRunMode" AS ENUM ('RONDA', 'AUDITORIA_SORPRESA');

ALTER TABLE "ShiftHandover"
  ADD COLUMN "pendingsReviewedAt" TIMESTAMP(3),
  ADD COLUMN "finalReviewAt" TIMESTAMP(3),
  ADD COLUMN "urgentAcknowledgedAt" TIMESTAMP(3);

ALTER TABLE "ChecklistRun"
  ADD COLUMN "mode" "ChecklistRunMode" NOT NULL DEFAULT 'RONDA';

UPDATE "ChecklistRun"
SET "mode" = 'AUDITORIA_SORPRESA'
WHERE "surprise" = TRUE
  AND ("scope" IS NOT NULL OR "sample" IS NOT NULL);

CREATE UNIQUE INDEX "ChecklistRun_one_open_per_user"
ON "ChecklistRun"("runById")
WHERE "finishedAt" IS NULL AND "deletedAt" IS NULL;

ALTER TABLE "SupervisionAuditImport"
  ADD COLUMN "sourceFiles" JSONB NOT NULL DEFAULT '[]'::jsonb;
