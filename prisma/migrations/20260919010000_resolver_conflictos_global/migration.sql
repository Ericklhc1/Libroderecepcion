ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACTUALIZACION_OPERATIVA';

-- Permite ejecutar la reconciliación global de conflictos a los tres roles
-- autorizados expresamente: Administrador de sistema, Supervisor y Gerencia.
--
-- Es una reparación auditada, no acceso general a check-in/check-out, llaves
-- ni edición de registros. Gerencia conserva sus demás restricciones.
--
-- REVERSIBLE: borrar las filas de RolePermission asociadas y luego Permission.

INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'conflict.resolve_all',
  'Resolver todos los conflictos operativos',
  'Supervisión'
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r
CROSS JOIN "Permission" AS p
WHERE r."key" IN ('ADMINISTRADOR_SISTEMA', 'SUPERVISOR', 'GERENCIA')
  AND p."key" = 'conflict.resolve_all'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
