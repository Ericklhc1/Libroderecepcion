-- AROH 1.36.0 · contexto operativo por habitación
-- La habitación es una dimensión de Novedades/operación, no una función PMS.

ALTER TABLE "OperationalAlarm"
  ADD COLUMN IF NOT EXISTS "roomId" TEXT;

ALTER TABLE "Guarantee"
  ADD COLUMN IF NOT EXISTS "roomId" TEXT;

ALTER TABLE "GymPass"
  ADD COLUMN IF NOT EXISTS "reservationCode" TEXT;

CREATE INDEX IF NOT EXISTS "OperationalAlarm_roomId_status_idx"
  ON "OperationalAlarm"("roomId", "status");

CREATE INDEX IF NOT EXISTS "Guarantee_roomId_idx"
  ON "Guarantee"("roomId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OperationalAlarm_roomId_fkey'
  ) THEN
    ALTER TABLE "OperationalAlarm"
      ADD CONSTRAINT "OperationalAlarm_roomId_fkey"
      FOREIGN KEY ("roomId") REFERENCES "Room"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Guarantee_roomId_fkey'
  ) THEN
    ALTER TABLE "Guarantee"
      ADD CONSTRAINT "Guarantee_roomId_fkey"
      FOREIGN KEY ("roomId") REFERENCES "Room"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill de contexto estructurado desde el número ya guardado.
UPDATE "Guarantee" AS g
SET "roomId" = r."id"
FROM "Room" AS r
WHERE g."roomId" IS NULL
  AND g."roomNumber" IS NOT NULL
  AND g."roomNumber" = r."number";

UPDATE "GymPass" AS p
SET "roomId" = r."id"
FROM "Room" AS r
WHERE p."roomId" IS NULL
  AND p."roomNumber" = r."number";
