-- Contexto operacional explícito y retrocompatible.
-- Columnas opcionales: el histórico sigue válido y los nuevos registros pueden
-- apuntar a la estadía exacta. Caja sigue siendo única y central.

ALTER TABLE "OperationalEntry" ADD COLUMN "stayId" TEXT;

ALTER TABLE "CashMovement"
  ADD COLUMN "stayId" TEXT,
  ADD COLUMN "guestId" TEXT;

ALTER TABLE "OperationalEntry"
  ADD CONSTRAINT "OperationalEntry_stayId_fkey"
  FOREIGN KEY ("stayId") REFERENCES "RoomStay"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_stayId_fkey"
  FOREIGN KEY ("stayId") REFERENCES "RoomStay"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_guestId_fkey"
  FOREIGN KEY ("guestId") REFERENCES "GuestReference"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OperationalEntry_stayId_idx" ON "OperationalEntry"("stayId");
CREATE INDEX "CashMovement_stayId_idx" ON "CashMovement"("stayId");
CREATE INDEX "CashMovement_guestId_idx" ON "CashMovement"("guestId");
