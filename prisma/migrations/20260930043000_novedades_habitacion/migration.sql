-- AROH 1.36.0 · contexto operativo por habitación
-- Habitación es contexto de Novedades; no representa ocupación ni estado PMS.

ALTER TABLE "OperationalAlarm"
ADD COLUMN "roomNumber" TEXT;

CREATE INDEX "OperationalAlarm_roomNumber_status_idx"
ON "OperationalAlarm"("roomNumber", "status");

ALTER TABLE "GymPass"
ADD COLUMN "reservationCode" TEXT;

CREATE INDEX "GymPass_roomNumber_serviceDate_idx"
ON "GymPass"("roomNumber", "serviceDate");

CREATE INDEX "GymPass_reservationCode_idx"
ON "GymPass"("reservationCode");

CREATE INDEX "Guarantee_roomNumber_idx"
ON "Guarantee"("roomNumber");
