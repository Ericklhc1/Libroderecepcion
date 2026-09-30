-- Tutoriales por módulo.
--
-- Una fila significa que el usuario ya recibió o descartó el tutorial del
-- módulo. El baseline marca como conocidos los módulos que YA estaban
-- habilitados al desplegar esta versión; así no bombardeamos a cuentas
-- existentes con tutoriales retroactivos. Sólo los accesos nuevos quedan
-- pendientes después de este punto.

CREATE TABLE "UserTutorialModule" (
  "userId" TEXT NOT NULL,
  "moduleKey" TEXT NOT NULL,
  "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outcome" TEXT NOT NULL DEFAULT 'COMPLETED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserTutorialModule_pkey" PRIMARY KEY ("userId", "moduleKey")
);

CREATE INDEX "UserTutorialModule_moduleKey_idx"
  ON "UserTutorialModule"("moduleKey");

ALTER TABLE "UserTutorialModule"
  ADD CONSTRAINT "UserTutorialModule_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Módulos visibles para cualquier cuenta autenticada.
INSERT INTO "UserTutorialModule" ("userId", "moduleKey", "outcome")
SELECT u."id", module."key", 'BASELINE'
FROM "User" u
CROSS JOIN (VALUES ('novedades'), ('habitaciones'), ('alertas')) AS module("key")
WHERE u."deletedAt" IS NULL
ON CONFLICT ("userId", "moduleKey") DO NOTHING;

-- Módulos condicionados por permisos vigentes del rol.
WITH access AS (
  SELECT DISTINCT
    u."id" AS "userId",
    CASE
      WHEN p."key" = 'cash.view' THEN 'caja'
      WHEN p."key" IN ('shift.start','shift.receive','shift.handover','shift.close','shift.manage') THEN 'turno'
      WHEN p."key" IN ('key.assign','key.inventory','key.stock') THEN 'llaves'
      WHEN p."key" = 'supervision.center.view' THEN 'supervision'
      WHEN p."key" = 'management.dashboard.view' THEN 'gerencia'
      WHEN p."key" = 'audit.view' THEN 'auditoria'
      WHEN p."key" IN ('user.manage','role.manage','system.configure','support.view') THEN 'administracion'
      ELSE NULL
    END AS "moduleKey"
  FROM "User" u
  JOIN "RolePermission" rp ON rp."roleId" = u."roleId"
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE u."deletedAt" IS NULL
)
INSERT INTO "UserTutorialModule" ("userId", "moduleKey", "outcome")
SELECT "userId", "moduleKey", 'BASELINE'
FROM access
WHERE "moduleKey" IS NOT NULL
ON CONFLICT ("userId", "moduleKey") DO NOTHING;
