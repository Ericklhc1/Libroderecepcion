-- Enable per-role Housekeeping access. Existing trial rows remain trials.
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES
  ('perm_housekeeping_view', 'housekeeping.view', 'Consultar avisos de Housekeeping', 'Housekeeping'),
  ('perm_housekeeping_manage', 'housekeeping.manage', 'Crear y gestionar avisos de Housekeeping', 'Housekeeping')
ON CONFLICT ("key") DO NOTHING;

-- Explicitly authorized administrator participation, without impersonation.
UPDATE "Role" SET "operational" = true,
  "description" = 'Control técnico y operativo: usuarios, permisos, configuración, responsabilidades, turnos y acciones auditadas.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'ADMINISTRADOR_SISTEMA';
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."key" = 'ADMINISTRADOR_SISTEMA'
  AND p."key" IN ('shift.start', 'shift.receive', 'shift.handover', 'shift.reassign', 'room.manage', 'key.assign', 'housekeeping.view', 'housekeeping.manage')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

ALTER TABLE "HousekeepingRequest" DROP CONSTRAINT "HousekeepingRequest_pilot_check";
ALTER TABLE "HousekeepingRequest" ALTER COLUMN "isDemo" SET DEFAULT false;
