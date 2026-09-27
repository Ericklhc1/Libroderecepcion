-- Apertura controlada de turno de emergencia.
-- Los campos son aditivos y no modifican turnos históricos existentes.
ALTER TABLE "Shift"
  ADD COLUMN "emergency" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emergencyReason" TEXT,
  ADD COLUMN "emergencySourceShiftId" TEXT,
  ADD COLUMN "emergencyAcknowledgedAt" TIMESTAMP(3);

CREATE INDEX "Shift_emergency_archivedAt_idx"
  ON "Shift"("emergency", "archivedAt");

CREATE INDEX "Shift_emergencySourceShiftId_idx"
  ON "Shift"("emergencySourceShiftId");
