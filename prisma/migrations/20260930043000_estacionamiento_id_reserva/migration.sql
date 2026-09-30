-- AROH 1.36.0 · Estacionamiento usa ID Reserva
-- Campo aditivo. vehiclePlate queda sólo para compatibilidad histórica.

ALTER TABLE "GymPass"
ADD COLUMN IF NOT EXISTS "reservationCode" TEXT;

UPDATE "GymPass" AS gp
SET "reservationCode" = rr."code"
FROM "ReservationReference" AS rr
WHERE gp."reservationCode" IS NULL
  AND gp."reservationReferenceId" = rr."id";
