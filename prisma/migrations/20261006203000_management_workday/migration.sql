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


INSERT INTO "Permission" ("id","key","name","group")
VALUES ('perm_workday_manage','workday.manage','Iniciar y cerrar mi jornada de jefatura en mis áreas','Mi jornada')
ON CONFLICT ("key") DO UPDATE SET "name"=EXCLUDED."name","group"=EXCLUDED."group";

INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT r."id",p."id"
FROM "Role" r CROSS JOIN "Permission" p
WHERE r."key" IN ('ADMINISTRADOR_SISTEMA','SUPERVISOR','SUPERVISOR_HOUSEKEEPING','AMA_DE_LLAVES')
  AND p."key"='workday.manage'
ON CONFLICT DO NOTHING;
