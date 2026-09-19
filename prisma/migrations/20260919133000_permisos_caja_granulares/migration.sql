-- Permisos atómicos de Caja. No cambia tablas ni datos operativos.
WITH cash_permissions("key", "name") AS (
  VALUES
    ('cash.view', 'Consultar Caja'),
    ('cash.manual_in', 'Registrar ingresos manuales'),
    ('cash.manual_out', 'Registrar egresos manuales'),
    ('cash.audit', 'Corroborar efectivo'),
    ('cash.guarantee_in', 'Registrar garantías en efectivo'),
    ('cash.guarantee_out', 'Devolver garantías en efectivo'),
    ('cash.treasury_transfer', 'Registrar egresos a tesorería'),
    ('cash.count_declare', 'Declarar arqueo al entregar turno'),
    ('cash.count_receive', 'Confirmar arqueo al recibir turno'),
    ('cash.usd_rate', 'Declarar tipo de cambio USD/CLP'),
    ('cash.close', 'Confirmar cierre formal de Caja'),
    ('cash.reopen', 'Reabrir cierre formal de Caja')
)
INSERT INTO "Permission" ("id", "key", "name", "group")
SELECT gen_random_uuid()::text, "key", "name", 'Caja'
FROM cash_permissions
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "group" = EXCLUDED."group";

WITH operational("roleKey", "permissionKey") AS (
  SELECT r, p
  FROM unnest(ARRAY['SUPERVISOR','RECEPCIONISTA','AUDITOR_NOCTURNO']) AS r
  CROSS JOIN unnest(ARRAY[
    'cash.view','cash.manual_in','cash.manual_out','cash.audit',
    'cash.guarantee_in','cash.guarantee_out','cash.treasury_transfer',
    'cash.count_declare','cash.count_receive','cash.usd_rate','cash.close'
  ]) AS p
  UNION ALL SELECT 'SUPERVISOR', 'cash.reopen'
  UNION ALL SELECT 'GERENCIA', 'cash.view'
), resolved AS (
  SELECT role."id" AS "roleId", permission."id" AS "permissionId"
  FROM operational o
  JOIN "Role" role ON role."key" = o."roleKey"
  JOIN "Permission" permission ON permission."key" = o."permissionKey"
)
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT "roleId", "permissionId" FROM resolved
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."key" = 'ADMINISTRADOR_SISTEMA' AND p."key" LIKE 'cash.%'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
