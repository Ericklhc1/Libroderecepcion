-- AROH 1.36.0 · contexto operativo por habitación
-- Aditivo: no convierte AROH en PMS. Habitación sólo identifica el contexto físico
-- de novedades, tareas, alertas, garantías y folios operativos.

ALTER TABLE "OperationalAlarm"
  ADD COLUMN IF NOT EXISTS "roomNumber" TEXT;

CREATE INDEX IF NOT EXISTS "OperationalAlarm_roomNumber_status_idx"
  ON "OperationalAlarm"("roomNumber", "status");

ALTER TABLE "GymPass"
  ADD COLUMN IF NOT EXISTS "reservationCode" TEXT;

CREATE INDEX IF NOT EXISTS "GymPass_roomNumber_serviceDate_idx"
  ON "GymPass"("roomNumber", "serviceDate");

CREATE INDEX IF NOT EXISTS "GymPass_reservationCode_idx"
  ON "GymPass"("reservationCode");

CREATE INDEX IF NOT EXISTS "Guarantee_roomNumber_idx"
  ON "Guarantee"("roomNumber");
