-- La base instalada había derivado de la matriz declarada en src/lib/permissions.ts.
-- Se reconstruyen únicamente los cinco roles del sistema; roles personalizados no se tocan.

UPDATE "Role"
SET "operational" = CASE "key"
  WHEN 'ADMINISTRADOR_SISTEMA' THEN false
  WHEN 'SUPERVISOR' THEN true
  WHEN 'RECEPCIONISTA' THEN true
  WHEN 'AUDITOR_NOCTURNO' THEN true
  WHEN 'GERENCIA' THEN true
  ELSE "operational"
END
WHERE "key" IN (
  'ADMINISTRADOR_SISTEMA', 'SUPERVISOR', 'RECEPCIONISTA', 'AUDITOR_NOCTURNO', 'GERENCIA'
);

DELETE FROM "RolePermission" rp
USING "Role" r
WHERE rp."roleId" = r."id"
  AND r."key" IN (
    'ADMINISTRADOR_SISTEMA', 'SUPERVISOR', 'RECEPCIONISTA', 'AUDITOR_NOCTURNO', 'GERENCIA'
  );

WITH desired("roleKey", "permissionKey") AS (
  VALUES
    -- Administrador de sistema: control técnico total, fuera del mesón.
    ('ADMINISTRADOR_SISTEMA','entry.create'),
    ('ADMINISTRADOR_SISTEMA','entry.edit'),
    ('ADMINISTRADOR_SISTEMA','entry.delete'),
    ('ADMINISTRADOR_SISTEMA','entry.close'),
    ('ADMINISTRADOR_SISTEMA','entry.reopen'),
    ('ADMINISTRADOR_SISTEMA','entry.restore'),
    ('ADMINISTRADOR_SISTEMA','task.create'),
    ('ADMINISTRADOR_SISTEMA','task.assign'),
    ('ADMINISTRADOR_SISTEMA','task.edit'),
    ('ADMINISTRADOR_SISTEMA','task.close'),
    ('ADMINISTRADOR_SISTEMA','incident.create'),
    ('ADMINISTRADOR_SISTEMA','incident.manage'),
    ('ADMINISTRADOR_SISTEMA','incident.close'),
    ('ADMINISTRADOR_SISTEMA','followup.create'),
    ('ADMINISTRADOR_SISTEMA','followup.manage'),
    ('ADMINISTRADOR_SISTEMA','alert.manage'),
    ('ADMINISTRADOR_SISTEMA','shift.close'),
    ('ADMINISTRADOR_SISTEMA','shift.manage'),
    ('ADMINISTRADOR_SISTEMA','nightaudit.run'),
    ('ADMINISTRADOR_SISTEMA','metrics.view'),
    ('ADMINISTRADOR_SISTEMA','audit.view'),
    ('ADMINISTRADOR_SISTEMA','guest.view'),
    ('ADMINISTRADOR_SISTEMA','guest.manage'),
    ('ADMINISTRADOR_SISTEMA','supervision.view'),
    ('ADMINISTRADOR_SISTEMA','room.view'),
    ('ADMINISTRADOR_SISTEMA','key.stock'),
    ('ADMINISTRADOR_SISTEMA','pms.import'),
    ('ADMINISTRADOR_SISTEMA','stay.delete'),
    ('ADMINISTRADOR_SISTEMA','room.reset'),
    ('ADMINISTRADOR_SISTEMA','announcement.manage'),
    ('ADMINISTRADOR_SISTEMA','user.manage'),
    ('ADMINISTRADOR_SISTEMA','role.manage'),
    ('ADMINISTRADOR_SISTEMA','system.configure'),

    -- Supervisor.
    ('SUPERVISOR','entry.create'),
    ('SUPERVISOR','entry.edit'),
    ('SUPERVISOR','entry.close'),
    ('SUPERVISOR','entry.reopen'),
    ('SUPERVISOR','entry.delete'),
    ('SUPERVISOR','task.create'),
    ('SUPERVISOR','task.edit'),
    ('SUPERVISOR','task.close'),
    ('SUPERVISOR','task.assign'),
    ('SUPERVISOR','incident.create'),
    ('SUPERVISOR','incident.manage'),
    ('SUPERVISOR','incident.close'),
    ('SUPERVISOR','followup.create'),
    ('SUPERVISOR','followup.manage'),
    ('SUPERVISOR','alert.manage'),
    ('SUPERVISOR','shift.start'),
    ('SUPERVISOR','shift.receive'),
    ('SUPERVISOR','shift.handover'),
    ('SUPERVISOR','shift.close'),
    ('SUPERVISOR','shift.manage'),
    ('SUPERVISOR','guest.view'),
    ('SUPERVISOR','guest.manage'),
    ('SUPERVISOR','metrics.view'),
    ('SUPERVISOR','room.view'),
    ('SUPERVISOR','room.manage'),
    ('SUPERVISOR','key.assign'),
    ('SUPERVISOR','key.stock'),
    ('SUPERVISOR','pms.import'),
    ('SUPERVISOR','room.reset'),
    ('SUPERVISOR','audit.view'),
    ('SUPERVISOR','announcement.manage'),
    ('SUPERVISOR','supervision.view'),

    -- Recepcionista.
    ('RECEPCIONISTA','entry.create'),
    ('RECEPCIONISTA','entry.edit'),
    ('RECEPCIONISTA','entry.close'),
    ('RECEPCIONISTA','task.create'),
    ('RECEPCIONISTA','task.edit'),
    ('RECEPCIONISTA','task.close'),
    ('RECEPCIONISTA','task.assign'),
    ('RECEPCIONISTA','incident.create'),
    ('RECEPCIONISTA','followup.create'),
    ('RECEPCIONISTA','followup.manage'),
    ('RECEPCIONISTA','alert.manage'),
    ('RECEPCIONISTA','shift.start'),
    ('RECEPCIONISTA','shift.receive'),
    ('RECEPCIONISTA','shift.handover'),
    ('RECEPCIONISTA','shift.close'),
    ('RECEPCIONISTA','guest.view'),
    ('RECEPCIONISTA','guest.manage'),
    ('RECEPCIONISTA','metrics.view'),
    ('RECEPCIONISTA','room.view'),
    ('RECEPCIONISTA','room.manage'),
    ('RECEPCIONISTA','key.assign'),
    ('RECEPCIONISTA','pms.import'),

    -- Auditor nocturno: operación de Recepción + controles nocturnos.
    ('AUDITOR_NOCTURNO','entry.create'),
    ('AUDITOR_NOCTURNO','entry.edit'),
    ('AUDITOR_NOCTURNO','entry.close'),
    ('AUDITOR_NOCTURNO','task.create'),
    ('AUDITOR_NOCTURNO','task.edit'),
    ('AUDITOR_NOCTURNO','task.close'),
    ('AUDITOR_NOCTURNO','task.assign'),
    ('AUDITOR_NOCTURNO','incident.create'),
    ('AUDITOR_NOCTURNO','incident.manage'),
    ('AUDITOR_NOCTURNO','followup.create'),
    ('AUDITOR_NOCTURNO','followup.manage'),
    ('AUDITOR_NOCTURNO','alert.manage'),
    ('AUDITOR_NOCTURNO','shift.start'),
    ('AUDITOR_NOCTURNO','shift.receive'),
    ('AUDITOR_NOCTURNO','shift.handover'),
    ('AUDITOR_NOCTURNO','shift.close'),
    ('AUDITOR_NOCTURNO','guest.view'),
    ('AUDITOR_NOCTURNO','guest.manage'),
    ('AUDITOR_NOCTURNO','metrics.view'),
    ('AUDITOR_NOCTURNO','room.view'),
    ('AUDITOR_NOCTURNO','room.manage'),
    ('AUDITOR_NOCTURNO','key.assign'),
    ('AUDITOR_NOCTURNO','pms.import'),
    ('AUDITOR_NOCTURNO','nightaudit.run'),

    -- Gerencia: consulta, sin escritura operativa.
    ('GERENCIA','guest.view'),
    ('GERENCIA','supervision.view'),
    ('GERENCIA','metrics.view'),
    ('GERENCIA','room.view'),
    ('GERENCIA','audit.view')
), resolved AS (
  SELECT r."id" AS "roleId", p."id" AS "permissionId"
  FROM desired d
  JOIN "Role" r ON r."key" = d."roleKey"
  JOIN "Permission" p ON p."key" = d."permissionKey"
)
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT "roleId", "permissionId" FROM resolved
ON CONFLICT DO NOTHING;
