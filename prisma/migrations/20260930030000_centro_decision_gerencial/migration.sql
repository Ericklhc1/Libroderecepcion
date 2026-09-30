-- Centro de Decisión Gerencial.
-- Permiso de lectura estratégica: no concede operación de Turnos, Caja, Llaves ni PMS.

INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'management.dashboard.view',
  'Ver Centro de Decisión Gerencial',
  'Gerencia'
)
ON CONFLICT ("key") DO UPDATE
SET "name" = EXCLUDED."name",
    "group" = EXCLUDED."group";

INSERT INTO "RolePermission" ("roleId", "permissionId", "requiresApproval")
SELECT r."id", p."id", false
FROM "Role" r
JOIN "Permission" p ON p."key" = 'management.dashboard.view'
WHERE r."key" IN ('GERENCIA', 'SUPERVISOR', 'ADMINISTRADOR_SISTEMA')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
