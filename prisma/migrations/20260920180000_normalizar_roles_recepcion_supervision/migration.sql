-- Corrige la deriva observada en Production sin sobrescribir políticas de
-- aprobación: sólo elimina permisos fuera de la matriz actual y agrega los
-- faltantes para Recepcionista y Supervisor.
CREATE TEMP TABLE "_CanonicalRolePermission20260920" (
  "roleKey" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  PRIMARY KEY ("roleKey", "permissionKey")
) ON COMMIT DROP;

INSERT INTO "_CanonicalRolePermission20260920" ("roleKey", "permissionKey")
VALUES
  -- Base operativa compartida.
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
  ('RECEPCIONISTA','cash.view'),
  ('RECEPCIONISTA','cash.manual_in'),
  ('RECEPCIONISTA','cash.manual_out'),
  ('RECEPCIONISTA','cash.audit'),
  ('RECEPCIONISTA','cash.guarantee_in'),
  ('RECEPCIONISTA','cash.guarantee_out'),
  ('RECEPCIONISTA','cash.treasury_transfer'),
  ('RECEPCIONISTA','cash.count_declare'),
  ('RECEPCIONISTA','cash.count_receive'),
  ('RECEPCIONISTA','cash.usd_rate'),
  ('RECEPCIONISTA','cash.close'),

  ('SUPERVISOR','entry.create'),
  ('SUPERVISOR','entry.edit'),
  ('SUPERVISOR','entry.close'),
  ('SUPERVISOR','task.create'),
  ('SUPERVISOR','task.edit'),
  ('SUPERVISOR','task.close'),
  ('SUPERVISOR','task.assign'),
  ('SUPERVISOR','incident.create'),
  ('SUPERVISOR','followup.create'),
  ('SUPERVISOR','followup.manage'),
  ('SUPERVISOR','alert.manage'),
  ('SUPERVISOR','shift.start'),
  ('SUPERVISOR','shift.receive'),
  ('SUPERVISOR','shift.handover'),
  ('SUPERVISOR','shift.close'),
  ('SUPERVISOR','guest.view'),
  ('SUPERVISOR','guest.manage'),
  ('SUPERVISOR','metrics.view'),
  ('SUPERVISOR','room.view'),
  ('SUPERVISOR','room.manage'),
  ('SUPERVISOR','key.assign'),
  ('SUPERVISOR','pms.import'),
  ('SUPERVISOR','cash.view'),
  ('SUPERVISOR','cash.manual_in'),
  ('SUPERVISOR','cash.manual_out'),
  ('SUPERVISOR','cash.audit'),
  ('SUPERVISOR','cash.guarantee_in'),
  ('SUPERVISOR','cash.guarantee_out'),
  ('SUPERVISOR','cash.treasury_transfer'),
  ('SUPERVISOR','cash.count_declare'),
  ('SUPERVISOR','cash.count_receive'),
  ('SUPERVISOR','cash.usd_rate'),
  ('SUPERVISOR','cash.close'),

  -- Capacidades exclusivas de Supervisión.
  ('SUPERVISOR','entry.reopen'),
  ('SUPERVISOR','entry.delete'),
  ('SUPERVISOR','incident.manage'),
  ('SUPERVISOR','incident.close'),
  ('SUPERVISOR','shift.manage'),
  ('SUPERVISOR','audit.view'),
  ('SUPERVISOR','key.stock'),
  ('SUPERVISOR','room.reset'),
  ('SUPERVISOR','conflict.resolve_all'),
  ('SUPERVISOR','announcement.manage'),
  ('SUPERVISOR','supervision.view'),
  ('SUPERVISOR','cash.reopen'),
  ('SUPERVISOR','cash.approve');

DELETE FROM "RolePermission" rp
USING "Role" r, "Permission" p
WHERE rp."roleId" = r."id"
  AND rp."permissionId" = p."id"
  AND r."key" IN ('RECEPCIONISTA', 'SUPERVISOR')
  AND NOT EXISTS (
    SELECT 1
    FROM "_CanonicalRolePermission20260920" desired
    WHERE desired."roleKey" = r."key"
      AND desired."permissionKey" = p."key"
  );

INSERT INTO "RolePermission" ("roleId", "permissionId", "requiresApproval")
SELECT r."id", p."id", false
FROM "_CanonicalRolePermission20260920" desired
JOIN "Role" r ON r."key" = desired."roleKey"
JOIN "Permission" p ON p."key" = desired."permissionKey"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
