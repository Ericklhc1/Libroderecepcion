-- AROH 1.36.0 · Supervisor también consulta el cockpit estratégico.
-- Sólo concede lectura del módulo Gerencia; no agrega acciones operativas nuevas.

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" = 'management.dashboard.view'
WHERE r."key" = 'SUPERVISOR'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
