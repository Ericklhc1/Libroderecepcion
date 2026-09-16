-- Los pases de gimnasio se venden a una estadía PMS activa (RoomStay).
-- ReservationReference todavía no se alimenta desde los informes en producción,
-- por lo que queda como vínculo opcional para compatibilidad futura.

ALTER TABLE "GymPass"
  ADD COLUMN IF NOT EXISTS "stayId" TEXT,
  ADD COLUMN IF NOT EXISTS "reservationCode" TEXT;

ALTER TABLE "GymPass"
  ALTER COLUMN "reservationReferenceId" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GymPass_stayId_fkey'
  ) THEN
    ALTER TABLE "GymPass"
      ADD CONSTRAINT "GymPass_stayId_fkey"
      FOREIGN KEY ("stayId") REFERENCES "RoomStay"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "GymPass_stayId_idx" ON "GymPass"("stayId");
CREATE INDEX IF NOT EXISTS "GymPass_reservationCode_idx" ON "GymPass"("reservationCode");
