-- El Administrador de sistema puede eliminar una estadía para resolver un
-- conflicto de llaves.
--
-- MOTIVO: un estado histórico incoherente —una estadía duplicada, una cargada
-- antes de que una regla existiera— puede dejar una habitación bloqueada, y la
-- operación necesita una salida que no sea tocar la base a mano.
--
-- Es REPARACIÓN, no operación, así que no contradice la regla de que el
-- administrador queda fuera de la operación habitual: no confirma salidas ni
-- entradas, y esta acción no lo deja como responsable de ninguna llegada. La
-- eliminación es LÓGICA, con motivo obligatorio, y libera la llave asignada.
--
-- Esta migración existe porque el catálogo de permisos y la matriz por rol se
-- siembran **al instalar**: cambiar el código no altera una base ya instalada.
--
-- Se une por clave, nunca por identificador —los de rol y permiso son cuid
-- generados en cada instalación— y no toca ninguna otra fila, de modo que los
-- permisos ajustados a mano desde /admin/roles se conservan.
--
-- REVERSIBLE: borrar la fila de RolePermission y la de Permission.

-- El permiso puede no existir todavía en una base instalada antes de este
-- cambio, así que se crea primero. gen_random_uuid basta como identificador:
-- el catálogo se une por "key", nunca por id.
INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'stay.delete',
  'Eliminar una estadía para resolver conflictos',
  'Habitaciones y llaves'
)
ON CONFLICT ("key") DO NOTHING;

-- La clave primaria es (roleId, permissionId), así que ON CONFLICT la hace
-- idempotente.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r
CROSS JOIN "Permission" AS p
WHERE r."key" = 'ADMINISTRADOR_SISTEMA'
  AND p."key" = 'stay.delete'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
