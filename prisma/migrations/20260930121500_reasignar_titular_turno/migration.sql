-- Permiso granular para cambiar quién figura como TITULAR del turno vigente.
--
-- El Supervisor lo recibe por defecto. Otros roles pueden activarlo o
-- desactivarlo desde Administración > Roles y permisos. El Administrador de
-- sistema permanece fuera de la operación habitual de Recepción.
--
-- La migración sólo incorpora la nueva clave y su concesión inicial; no toca
-- ningún otro permiso configurado manualmente.

INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'shift.reassign',
  'Reasignar titular del turno',
  'Turnos'
)
ON CONFLICT ("key") DO UPDATE
SET "name" = EXCLUDED."name",
    "group" = EXCLUDED."group";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r
CROSS JOIN "Permission" AS p
WHERE r."key" = 'SUPERVISOR'
  AND p."key" = 'shift.reassign'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
