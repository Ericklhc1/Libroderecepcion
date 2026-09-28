-- Central de Reservas + Gerencia operativa + correo individual.
-- Cambio aditivo: no modifica turnos, caja, llaves ni datos operativos existentes.

-- 1) Canal de correo por usuario. El username sigue siendo la identidad de acceso.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");

-- 2) Permiso de entrada a la bandeja especializada.
INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'reservation.center.view',
  'Ver la bandeja operativa de Central de Reservas',
  'Central de Reservas'
)
ON CONFLICT ("key") DO UPDATE
SET "name" = EXCLUDED."name", "group" = EXCLUDED."group";

-- 3) Nuevo rol: operativo como destinatario de tareas/seguimientos, pero fuera del mesón.
INSERT INTO "Role" ("id", "key", "name", "description", "level", "isSystem", "operational", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'CENTRAL_RESERVAS',
  'Ejecutivo/a de Central de Reservas',
  'Prepara y mantiene la información previa a la estadía, resuelve pendientes de reserva y coordina acciones con Recepción sin operar turnos, Caja ni llaves.',
  35,
  true,
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "level" = EXCLUDED."level",
  "isSystem" = true,
  "operational" = true,
  "updatedAt" = NOW();

-- 4) Actualiza la definición de Gerencia.
UPDATE "Role"
SET
  "name" = 'Gerencia de operaciones',
  "description" = 'Dirección operativa transversal: analiza, asigna acciones, administra seguimientos, comunica lineamientos y verifica cumplimiento sin operar turnos, Caja ni llaves.',
  "level" = 70,
  "operational" = true,
  "isSystem" = true,
  "updatedAt" = NOW()
WHERE "key" = 'GERENCIA';

-- 5) Matriz del nuevo rol.
WITH desired("permissionKey") AS (
  VALUES
    ('reservation.center.view'),
    ('guest.view'),
    ('guest.manage'),
    ('room.view'),
    ('metrics.view'),
    ('entry.create'),
    ('entry.edit'),
    ('entry.close'),
    ('task.create'),
    ('task.assign'),
    ('task.edit'),
    ('task.close'),
    ('followup.create'),
    ('followup.manage'),
    ('alert.manage')
)
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM desired d
JOIN "Permission" p ON p."key" = d."permissionKey"
JOIN "Role" r ON r."key" = 'CENTRAL_RESERVAS'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 6) Supervisión, Gerencia y Administrador pueden consultar la bandeja.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" = 'reservation.center.view'
WHERE r."key" IN ('ADMINISTRADOR_SISTEMA', 'SUPERVISOR', 'GERENCIA')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 7) Gerencia puede dirigir acciones y consultar Supervisión, sin permisos de
-- turno, movimientos de Caja, llaves ni edición general de reservas.
WITH desired("permissionKey") AS (
  VALUES
    ('guest.view'),
    ('reservation.center.view'),
    ('supervision.view'),
    ('supervision.center.view'),
    ('supervision.task.assign'),
    ('supervision.followup.manage'),
    ('supervision.audit.reserved'),
    ('supervision.performance.view'),
    ('supervision.history.view'),
    ('metrics.view'),
    ('room.view'),
    ('audit.view'),
    ('cash.view'),
    ('task.create'),
    ('task.assign'),
    ('followup.create'),
    ('followup.manage'),
    ('announcement.manage'),
    ('conflict.resolve_all')
)
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM desired d
JOIN "Permission" p ON p."key" = d."permissionKey"
JOIN "Role" r ON r."key" = 'GERENCIA'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
