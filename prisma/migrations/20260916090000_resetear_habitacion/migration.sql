-- El Administrador de sistema y el Supervisor pueden resetear una habitación.
--
-- MOTIVO: cuando dos estadías de la misma reserva conviven en una habitación,
-- el mesón no puede confirmar el check-in ni el check-out porque la regla de
-- cola ve un conflicto que en la realidad no existe. El reseteo colapsa las
-- duplicadas, libera las llaves huérfanas y vuelve a aplicar la regla de la
-- llave principal.
--
-- Lo tiene TAMBIÉN el Supervisor, no sólo el administrador: el atasco ocurre
-- en el mesón y no puede esperar. Sigue siendo reparación y no operación, así
-- que no contradice la exclusión del administrador de la operación habitual.
--
-- El catálogo de permisos y la matriz por rol se siembran al instalar, así que
-- cambiar el código no basta para una base ya instalada. Se une por clave y no
-- se toca ninguna otra fila.
--
-- REVERSIBLE: borrar las dos filas de RolePermission y la de Permission.

INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'room.reset',
  'Resetear una habitación atascada',
  'Habitaciones y llaves'
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r
CROSS JOIN "Permission" AS p
WHERE r."key" IN ('ADMINISTRADOR_SISTEMA', 'SUPERVISOR')
  AND p."key" = 'room.reset'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
