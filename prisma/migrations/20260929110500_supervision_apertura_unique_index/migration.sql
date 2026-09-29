-- PREPARACION también es un turno abierto.
-- Va en una migración posterior al ALTER TYPE para que PostgreSQL pueda usar
-- el nuevo valor enum con seguridad en el predicado del índice parcial.
DROP INDEX IF EXISTS "supervision_shift_one_open_per_supervisor";

CREATE UNIQUE INDEX "supervision_shift_one_open_per_supervisor"
  ON "SupervisionShift"("supervisorId")
  WHERE "status" IN ('PREPARACION', 'ACTIVO', 'ENTREGADO');
