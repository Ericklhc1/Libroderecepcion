-- Cierre de Caja independiente del cierre de Turno.
-- La fotografía queda congelada para auditoría y el turno sólo puede cerrarse
-- después de que Caja haya quedado confirmada.
CREATE TABLE IF NOT EXISTS "ShiftCashClosure" (
  "id" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "closedById" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshot" JSONB NOT NULL,
  "notes" TEXT,
  "reopenedAt" TIMESTAMP(3),
  "reopenedById" TEXT,
  "reopenReason" TEXT,

  CONSTRAINT "ShiftCashClosure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShiftCashClosure_shiftId_key"
  ON "ShiftCashClosure"("shiftId");
CREATE INDEX IF NOT EXISTS "ShiftCashClosure_closedAt_idx"
  ON "ShiftCashClosure"("closedAt");

DO $$ BEGIN
  ALTER TABLE "ShiftCashClosure"
    ADD CONSTRAINT "ShiftCashClosure_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftCashClosure"
    ADD CONSTRAINT "ShiftCashClosure_closedById_fkey"
    FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftCashClosure"
    ADD CONSTRAINT "ShiftCashClosure_reopenedById_fkey"
    FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;