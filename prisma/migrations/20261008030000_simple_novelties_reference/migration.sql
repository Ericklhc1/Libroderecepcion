-- Optional external booking reference; no PMS records or data changes.
ALTER TABLE "OperationalEntry" ADD COLUMN "reservationReference" TEXT;
