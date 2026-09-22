-- Separa el instante técnico de registro del instante operacional del movimiento.
-- Los movimientos históricos conservan como fecha efectiva su createdAt.

ALTER TABLE "CashMovement"
  ADD COLUMN "effectiveAt" TIMESTAMP(3);

UPDATE "CashMovement"
SET "effectiveAt" = "createdAt"
WHERE "effectiveAt" IS NULL;

ALTER TABLE "CashMovement"
  ALTER COLUMN "effectiveAt" SET NOT NULL,
  ALTER COLUMN "effectiveAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "CashMovement_effectiveAt_idx"
  ON "CashMovement"("effectiveAt");
