-- Matriz de Caja: permiso y aprobación son controles independientes.
-- Por defecto ningún permiso exige aprobación.
ALTER TABLE "RolePermission"
  ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'cash.approve',
  'Autorizar operaciones de Caja que requieran aprobación',
  'Caja'
)
ON CONFLICT ("key") DO UPDATE
SET "name" = EXCLUDED."name", "group" = EXCLUDED."group";

INSERT INTO "RolePermission" ("roleId", "permissionId", "requiresApproval")
SELECT r."id", p."id", false
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA')
  AND p."key" = 'cash.approve'
ON CONFLICT ("roleId", "permissionId") DO UPDATE
SET "requiresApproval" = false;
