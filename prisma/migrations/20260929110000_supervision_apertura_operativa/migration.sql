-- Apertura operacional de Supervisión: estado preparatorio y evidencia inalterable del inicio.
ALTER TYPE "SupervisionShiftStatus" ADD VALUE IF NOT EXISTS 'PREPARACION' BEFORE 'ACTIVO';

ALTER TABLE "SupervisionShift"
  ADD COLUMN IF NOT EXISTS "openingState" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "openingCompletedAt" TIMESTAMP(3);


-- PREPARACION también es un turno abierto. La unicidad debe cubrir las tres fases
-- para que dos clics concurrentes no dejen dos aperturas vivas para el mismo Supervisor.
DROP INDEX IF EXISTS "supervision_shift_one_open_per_supervisor";
CREATE UNIQUE INDEX "supervision_shift_one_open_per_supervisor"
  ON "SupervisionShift"("supervisorId")
  WHERE "status"::text IN ('PREPARACION', 'ACTIVO', 'ENTREGADO');
