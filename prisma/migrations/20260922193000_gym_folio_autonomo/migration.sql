-- Folio de gimnasio autónomo de Caja.
-- Conserva las columnas históricas para compatibilidad, pero los folios nuevos
-- ya no dependen de PMS, habitación interna, reserva ni OperationalEntry.

ALTER TABLE "GymPass"
  ADD COLUMN IF NOT EXISTS "serviceDate" DATE,
  ADD COLUMN IF NOT EXISTS "roomNumber" TEXT;

-- Backfill defensivo para cualquier folio histórico.
UPDATE "GymPass"
SET "serviceDate" = COALESCE("serviceDate", "issuedAt"::date)
WHERE "serviceDate" IS NULL;

UPDATE "GymPass" gp
SET "roomNumber" = COALESCE(gp."roomNumber", r."number")
FROM "Room" r
WHERE gp."roomId" = r."id"
  AND gp."roomNumber" IS NULL;

UPDATE "GymPass"
SET "roomNumber" = COALESCE("roomNumber", 'Sin habitación')
WHERE "roomNumber" IS NULL;

ALTER TABLE "GymPass"
  ALTER COLUMN "serviceDate" SET NOT NULL,
  ALTER COLUMN "roomNumber" SET NOT NULL,
  ALTER COLUMN "reservationReferenceId" DROP NOT NULL,
  ALTER COLUMN "roomId" DROP NOT NULL,
  ALTER COLUMN "operationalEntryId" DROP NOT NULL,
  ALTER COLUMN "currency" DROP NOT NULL,
  ALTER COLUMN "amount" DROP NOT NULL,
  ALTER COLUMN "paymentMethod" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "GymPass_serviceDate_idx"
  ON "GymPass"("serviceDate");
