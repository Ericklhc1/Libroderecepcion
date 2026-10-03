-- Etapa 3 / Bloque 2: compatibilidad con aclaraciones creadas en 1.49.0.
-- Sólo normaliza filas que permanecen en espera/bloqueo y cuya última acción
-- de Coordinación registrada fue una solicitud de aclaración.
UPDATE "OperationalEntry" e
SET "workNextAction" = 'Aclaración requerida: ' || e."workNextAction"
WHERE e."status" = 'EN_ESPERA'
  AND e."workNextAction" IS NOT NULL
  AND e."workNextAction" NOT LIKE 'Aclaración requerida:%'
  AND EXISTS (
    SELECT 1
    FROM "AuditLog" a
    WHERE a."entity" = 'OperationalEntry'
      AND a."entityId" = e."id"
      AND a."summary" = 'Coordinación #' || e."humanId"::text || ': ACLARACION'
      AND a."createdAt" = (
        SELECT MAX(a2."createdAt")
        FROM "AuditLog" a2
        WHERE a2."entity" = 'OperationalEntry'
          AND a2."entityId" = e."id"
          AND a2."summary" LIKE 'Coordinación #%'
      )
  );

UPDATE "Task" t
SET "workNextAction" = 'Aclaración requerida: ' || t."workNextAction",
    "blockedReason" = 'Aclaración requerida: ' || COALESCE(t."blockedReason", t."workNextAction")
WHERE t."status" = 'BLOQUEADA'
  AND t."workNextAction" IS NOT NULL
  AND t."workNextAction" NOT LIKE 'Aclaración requerida:%'
  AND EXISTS (
    SELECT 1
    FROM "AuditLog" a
    WHERE a."entity" = 'Task'
      AND a."entityId" = t."id"
      AND a."summary" = 'Coordinación #' || t."humanId"::text || ': ACLARACION'
      AND a."createdAt" = (
        SELECT MAX(a2."createdAt")
        FROM "AuditLog" a2
        WHERE a2."entity" = 'Task'
          AND a2."entityId" = t."id"
          AND a2."summary" LIKE 'Coordinación #%'
      )
  );
