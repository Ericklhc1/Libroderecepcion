-- Libro 1.20.0: arqueos imprimibles y folios de estacionamiento.
-- Cambios exclusivamente aditivos: no reescriben ni eliminan datos existentes.

ALTER TABLE "CashAudit"
  ADD COLUMN "denominationSnapshot" JSONB;

ALTER TABLE "GymPass"
  ADD COLUMN "serviceType" TEXT NOT NULL DEFAULT 'GIMNASIO',
  ADD COLUMN "vehiclePlate" TEXT;

CREATE INDEX "GymPass_serviceType_serviceDate_idx"
  ON "GymPass"("serviceType", "serviceDate");
