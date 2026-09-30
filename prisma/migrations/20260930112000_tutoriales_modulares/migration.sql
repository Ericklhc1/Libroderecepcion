-- Tutoriales modulares por acceso.
--
-- Las cuentas que YA terminaron el recorrido general quedan inicializadas con
-- los módulos que actualmente pueden ver, para no disparar tutoriales viejos
-- después del despliegue. Desde aquí en adelante, un permiso/módulo nuevo que
-- no esté en esta lista se detecta como onboarding pendiente.
--
-- Las cuentas que todavía no terminaron el recorrido general conservan la
-- lista vacía: al finalizar ese recorrido se inicializa con sus módulos
-- vigentes desde servidor.

ALTER TABLE "User"
  ADD COLUMN "tutorialKnownModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "User" AS u
SET "tutorialKnownModules" =
  ARRAY['novedades', 'habitaciones', 'alertas']::TEXT[]
  || CASE WHEN EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE rp."roleId" = u."roleId"
      AND p."key" = 'cash.view'
  ) THEN ARRAY['caja']::TEXT[] ELSE ARRAY[]::TEXT[] END
  || CASE WHEN EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE rp."roleId" = u."roleId"
      AND p."key" IN ('shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage')
  ) THEN ARRAY['turno']::TEXT[] ELSE ARRAY[]::TEXT[] END
  || CASE WHEN EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE rp."roleId" = u."roleId"
      AND p."key" IN ('key.assign', 'key.inventory', 'key.stock')
  ) THEN ARRAY['llaves']::TEXT[] ELSE ARRAY[]::TEXT[] END
  || CASE WHEN EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE rp."roleId" = u."roleId"
      AND p."key" = 'supervision.center.view'
  ) THEN ARRAY['supervision']::TEXT[] ELSE ARRAY[]::TEXT[] END
  || CASE WHEN EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE rp."roleId" = u."roleId"
      AND p."key" = 'management.dashboard.view'
  ) THEN ARRAY['gerencia']::TEXT[] ELSE ARRAY[]::TEXT[] END
  || CASE WHEN EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE rp."roleId" = u."roleId"
      AND p."key" = 'audit.view'
  ) THEN ARRAY['auditoria']::TEXT[] ELSE ARRAY[]::TEXT[] END
  || CASE WHEN EXISTS (
    SELECT 1
    FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE rp."roleId" = u."roleId"
      AND p."key" IN ('user.manage', 'role.manage', 'system.configure', 'support.view')
  ) THEN ARRAY['administracion']::TEXT[] ELSE ARRAY[]::TEXT[] END
WHERE u."tutorialDoneAt" IS NOT NULL;
