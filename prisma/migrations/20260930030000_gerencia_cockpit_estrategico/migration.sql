-- AROH 1.35.0 · Cockpit estratégico de Gerencia
-- Permiso aditivo de consulta. No concede acciones operativas ni modifica datos.

INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'management.dashboard.view',
  'Ver cockpit estratégico de Gerencia',
  'Gerencia'
)
ON CONFLICT ("key") DO UPDATE
SET "name" = EXCLUDED."name", "group" = EXCLUDED."group";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" = 'management.dashboard.view'
WHERE r."key" IN ('GERENCIA', 'ADMINISTRADOR_SISTEMA')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
