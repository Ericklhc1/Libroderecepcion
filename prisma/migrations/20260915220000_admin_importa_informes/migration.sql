-- El Administrador de sistema puede importar los informes del PMS.
--
-- La exclusión original era una mala aplicación de la regla del proyecto: el
-- Administrador de sistema debe quedar fuera de la operación habitual —no
-- inicia, recibe ni entrega turno, no confirma salidas ni entradas, no entrega
-- llaves—, porque en esas acciones aparecería como responsable operativo.
-- Importar los tres informes del día no es nada de eso: es alimentar el
-- sistema con su fuente de datos, y no asigna a nadie como responsable.
--
-- Al excluirlo quedaba un callejón sin salida: en un hotel recién instalado la
-- única cuenta es la del administrador, y no podía cargar el primer día.
--
-- Esta migración existe porque la matriz de permisos se siembra **al
-- instalar**: cambiar ROLE_PERMISSIONS en el código no altera una base ya
-- instalada. Toda modificación de la matriz necesita su migración.
--
-- Se une por clave, nunca por identificador: los de rol y permiso son cuid
-- generados en cada instalación. Y no toca ninguna otra fila, de modo que los
-- permisos que el administrador haya ajustado a mano desde la interfaz se
-- conservan. Reversible: basta borrar esta fila.

-- La clave primaria es (roleId, permissionId), así que ON CONFLICT la hace
-- idempotente sin necesidad de inventar un identificador.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r
CROSS JOIN "Permission" AS p
WHERE r."key" = 'ADMINISTRADOR_SISTEMA'
  AND p."key" = 'pms.import'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
