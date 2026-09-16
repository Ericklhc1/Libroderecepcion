-- Rol de Gerencia de operaciones: sólo consulta.
--
-- Ni un permiso de escritura. Lo que sí puede hacer es actuar sobre aquello de
-- lo que se le hizo RESPONSABLE, y eso no se concede con un permiso —sería un
-- permiso sobre todos los registros— sino comprobando la propiedad del
-- registro concreto en el servidor (`requirePermissionOrOwner`).
--
-- `operational = true` porque tiene que poder figurar como responsable. No
-- puede tomar turnos igualmente: le faltan shift.start, shift.receive y
-- shift.handover.
--
-- Dos permisos de LECTURA nuevos, y son necesarios: hasta ahora ver la ficha
-- de un huésped exigía `guest.manage`, que además permite EDITARLO, y ver
-- Supervisión exigía gestionar incidencias. Un rol de consulta no puede
-- necesitar permisos de escritura para mirar. Se conceden también a los roles
-- que ya podían hacer ambas cosas, para no quitarles nada.
--
-- COMPATIBILIDAD: aditiva. Un rol nuevo, dos permisos nuevos y filas de
-- RolePermission. Ninguna cuenta existente cambia de permisos salvo para GANAR
-- los dos de lectura que antes iban implícitos en los de escritura.
--
-- REVERSIBLE: borrar el rol, los dos permisos y sus filas de RolePermission.

INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES
  (gen_random_uuid()::text, 'guest.view', 'Consultar huéspedes y reservas', 'Huéspedes y reservas'),
  (gen_random_uuid()::text, 'supervision.view', 'Consultar el tablero de supervisión', 'Supervisión')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Role" ("id", "key", "name", "description", "level", "isSystem", "operational", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'GERENCIA',
  'Gerencia de operaciones',
  'Consulta toda la operación sin intervenirla. Puede actuar únicamente sobre lo que se le asigne como responsable, y sólo el Supervisor puede asignárselo.',
  70,
  true,
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

-- Matriz de Gerencia: cinco permisos, todos de lectura.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r
CROSS JOIN "Permission" AS p
WHERE r."key" = 'GERENCIA'
  AND p."key" IN ('guest.view', 'supervision.view', 'metrics.view', 'room.view', 'audit.view')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Quien podía editar huéspedes ahora también tiene el de consultarlos, y quien
-- gestionaba incidencias o turnos tiene el de consultar Supervisión. No se le
-- quita nada a nadie: sólo se hace explícito lo que ya podía hacer.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", nuevo."id"
FROM "RolePermission" AS rp
JOIN "Permission" AS antiguo ON antiguo."id" = rp."permissionId"
CROSS JOIN "Permission" AS nuevo
WHERE antiguo."key" = 'guest.manage' AND nuevo."key" = 'guest.view'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", nuevo."id"
FROM "RolePermission" AS rp
JOIN "Permission" AS antiguo ON antiguo."id" = rp."permissionId"
CROSS JOIN "Permission" AS nuevo
WHERE antiguo."key" IN ('incident.manage', 'shift.manage') AND nuevo."key" = 'supervision.view'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
