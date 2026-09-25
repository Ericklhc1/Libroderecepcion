-- v1.11.0 · Continuidad transversal de Supervisión
-- Un seguimiento puede apuntar al objeto real que lo originó sin duplicarlo.

ALTER TABLE "FollowUp"
  ADD COLUMN "sourceEntity" TEXT,
  ADD COLUMN "sourceId" TEXT;

CREATE INDEX "FollowUp_sourceEntity_sourceId_idx"
  ON "FollowUp"("sourceEntity", "sourceId");
