-- Permiso específico para conteo físico de llaves y aislamiento de capacidades
-- PMS de los roles operativos. No elimina datos ni tablas históricas.

INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'key.inventory',
  'Realizar inventarios físicos por piso',
  'Llaves'
)
ON CONFLICT ("key") DO UPDATE
SET "name" = EXCLUDED."name", "group" = EXCLUDED."group";

INSERT INTO "RolePermission" ("roleId", "permissionId", "requiresApproval")
SELECT r."id", p."id", false
FROM "Role" r
JOIN "Permission" p ON p."key" = 'key.inventory'
WHERE r."key" IN (
  'ADMINISTRADOR_SISTEMA',
  'SUPERVISOR',
  'RECEPCIONISTA',
  'AUDITOR_NOCTURNO'
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- PMS, gestión de reservas y estados de habitación dejan de formar parte del
-- perfil operativo base. Se conserva consulta de habitación/huésped como
-- referencia y el Administrador técnico mantiene acceso histórico.
DELETE FROM "RolePermission" rp
USING "Role" r, "Permission" p
WHERE rp."roleId" = r."id"
  AND rp."permissionId" = p."id"
  AND r."key" IN ('SUPERVISOR', 'RECEPCIONISTA', 'AUDITOR_NOCTURNO')
  AND p."key" IN ('pms.import', 'room.manage', 'guest.manage');
