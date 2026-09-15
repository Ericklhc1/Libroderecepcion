-- Índices para los patrones de consulta que la aplicación usa de verdad.
--
-- El libro operativo consulta sus cuatro fuentes ordenadas por fecha
-- descendente con un límite. Task, FollowUp y Alert no tenían índice por
-- "createdAt", de modo que cada carga ordenaba el conjunto completo.
--
-- RoomStay se busca por reserva en la regla de cola y al cerrar la estadía
-- hermana de la misma reserva en la habitación.
--
-- Son índices reversibles: crearlos y eliminarlos no altera ningún dato.
-- IF NOT EXISTS los hace idempotentes si la migración se reintenta.

CREATE INDEX IF NOT EXISTS "Task_createdAt_idx" ON "Task"("createdAt");
CREATE INDEX IF NOT EXISTS "FollowUp_createdAt_idx" ON "FollowUp"("createdAt");
CREATE INDEX IF NOT EXISTS "Alert_createdAt_idx" ON "Alert"("createdAt");
CREATE INDEX IF NOT EXISTS "RoomStay_reservationId_idx" ON "RoomStay"("reservationId");
