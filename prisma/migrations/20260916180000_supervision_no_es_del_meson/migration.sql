-- Supervisión no es una pantalla del mesón.
--
-- El Auditor nocturno es un perfil DE RECEPCIÓN y tenía `supervision.view`,
-- así que le aparecía la pestaña de Supervisión. Supervisión es donde se revisa
-- el trabajo del mesón; que la vea quien está en el mesón no tiene sentido y
-- confunde sobre quién valida a quién.
--
-- Se le quita SÓLO `supervision.view`. Conserva `incident.manage`: de noche hay
-- que poder registrar y mover una incidencia sin despertar a nadie.
--
-- El otro lado del arreglo está en el código: el menú mostraba Supervisión a
-- cualquiera con `incident.manage`, permiso que el mesón sí tiene. Eso se
-- corrigió en `components/layout/nav-items.ts`.
--
-- SE RESPETA EL AJUSTE MANUAL de otros roles: el UPDATE toca una única fila,
-- identificada por rol y permiso, y no reescribe la matriz.
--
-- REVERSIBLE: volver a insertar la fila.

DELETE FROM "RolePermission"
WHERE "roleId" = (SELECT "id" FROM "Role" WHERE "key" = 'AUDITOR_NOCTURNO')
  AND "permissionId" = (SELECT "id" FROM "Permission" WHERE "key" = 'supervision.view');
