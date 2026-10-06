-- Jornadas independientes de jefatura por área.
ALTER TABLE "SupervisionShift"
  ADD COLUMN IF NOT EXISTS "departmentId" TEXT;

ALTER TABLE "SupervisionShift"
  DROP CONSTRAINT IF EXISTS "SupervisionShift_departmentId_fkey";

ALTER TABLE "SupervisionShift"
  ADD CONSTRAINT "SupervisionShift_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "SupervisionShift_departmentId_status_idx"
  ON "SupervisionShift"("departmentId","status");

CREATE UNIQUE INDEX IF NOT EXISTS "SupervisionShift_one_open_management_workday"
  ON "SupervisionShift"("supervisorId","departmentId")
  WHERE "departmentId" IS NOT NULL
    AND "status" IN ('ACTIVO','ENTREGADO');
