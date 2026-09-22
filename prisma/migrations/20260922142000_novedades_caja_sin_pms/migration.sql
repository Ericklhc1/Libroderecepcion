-- v1.4.0 — Novedades + Caja como núcleo operativo.
-- Los vínculos PMS se conservan sólo como legado opcional; las garantías nuevas
-- se identifican mediante contexto directo escrito por Recepción.

ALTER TABLE "Guarantee"
  ADD COLUMN "guestName" TEXT,
  ADD COLUMN "roomNumber" TEXT,
  ADD COLUMN "reference" TEXT,
  ADD COLUMN "dueAt" TIMESTAMP(3);

ALTER TABLE "Guarantee"
  ALTER COLUMN "reservationReferenceId" DROP NOT NULL;

ALTER TABLE "Guarantee"
  DROP CONSTRAINT IF EXISTS "Guarantee_reservationReferenceId_fkey",
  DROP CONSTRAINT IF EXISTS "Guarantee_stayId_fkey";

ALTER TABLE "Guarantee"
  ADD CONSTRAINT "Guarantee_reservationReferenceId_fkey"
    FOREIGN KEY ("reservationReferenceId")
    REFERENCES "ReservationReference"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Guarantee_stayId_fkey"
    FOREIGN KEY ("stayId")
    REFERENCES "RoomStay"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Guarantee_dueAt_idx" ON "Guarantee"("dueAt");
