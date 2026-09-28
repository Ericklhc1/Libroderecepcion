-- Regularización auditada del ciclo de turnos 26–27/09/2026.
--
-- Contexto operativo:
-- - quedaron turnos de Recepción abiertos bajo versiones anteriores del flujo;
-- - el relevo de Humberto (DÍA 27/09) hacia Yailin (NOCHE 27/09) quedó
--   interrumpido por la apertura de emergencia;
-- - varias validaciones posteriores permanecieron abiertas aunque la operación
--   ya había continuado.
--
-- Esta reparación NO inventa un recuento físico retroactivo. Cuando falta un
-- cierre formal de Caja se crea una constancia administrativa explícita, con
-- monedas/garantías vacías y una nota que la distingue de un arqueo físico.
-- Los handovers regularizados llevan la misma advertencia en observaciones.
--
-- El cambio es deliberadamente acotado a Production histórica hasta 27/09/2026
-- y a registros no demo. En bases de CI recién sembradas no encuentra filas.

BEGIN;

CREATE TEMP TABLE "_repair_target_shifts" ON COMMIT DROP AS
SELECT s."id"
FROM "Shift" s
WHERE s."isDemo" = FALSE
  AND s."archivedAt" IS NULL
  AND s."date" <= DATE '2026-09-27'
  AND s."status" IN (
    'INICIADO'::"ShiftStatus",
    'ACTIVO'::"ShiftStatus",
    'PREPARANDO_ENTREGA'::"ShiftStatus",
    'ENTREGA_ENVIADA'::"ShiftStatus",
    'RECIBIDO'::"ShiftStatus"
  );

-- 1) Satisfacer la barrera de Caja sin fingir arqueos físicos inexistentes.
--    Si ya existe un cierre reabierto, sólo se regulariza su vigencia y se
--    conserva su snapshot original.
INSERT INTO "ShiftCashClosure" (
  "id", "shiftId", "closedById", "closedAt", "snapshot", "notes",
  "reopenedAt", "reopenedById", "reopenReason"
)
SELECT
  gen_random_uuid()::text,
  s."id",
  COALESCE(
    (SELECT u."id"
     FROM "User" u
     WHERE lower(u."username") = lower('EHerrera')
       AND u."active" = TRUE
       AND u."deletedAt" IS NULL
     LIMIT 1),
    s."startedById",
    s."createdById",
    (SELECT sa."userId"
     FROM "ShiftAssignment" sa
     WHERE sa."shiftId" = s."id"
     ORDER BY sa."activatedAt" NULLS LAST, sa."createdAt"
     LIMIT 1)
  ),
  CURRENT_TIMESTAMP,
  jsonb_build_object(
    'shiftId', s."id",
    'capturedAt', CURRENT_TIMESTAMP::text,
    'currencies', '[]'::jsonb,
    'openCashGuarantees', 0,
    'guarantees', '[]'::jsonb,
    'administrativeRegularization', TRUE,
    'note', 'Regularización autorizada: no representa un recuento físico retroactivo.'
  ),
  'Regularización administrativa autorizada el 27/09/2026. No equivale a un arqueo físico retroactivo.',
  NULL,
  NULL,
  NULL
FROM "Shift" s
JOIN "_repair_target_shifts" t ON t."id" = s."id"
WHERE EXISTS (SELECT 1 FROM "CashFund" f WHERE f."active" = TRUE)
  AND COALESCE(
    (SELECT u."id"
     FROM "User" u
     WHERE lower(u."username") = lower('EHerrera')
       AND u."active" = TRUE
       AND u."deletedAt" IS NULL
     LIMIT 1),
    s."startedById",
    s."createdById",
    (SELECT sa."userId"
     FROM "ShiftAssignment" sa
     WHERE sa."shiftId" = s."id"
     ORDER BY sa."activatedAt" NULLS LAST, sa."createdAt"
     LIMIT 1)
  ) IS NOT NULL
ON CONFLICT ("shiftId") DO UPDATE SET
  "closedById" = EXCLUDED."closedById",
  "closedAt" = CURRENT_TIMESTAMP,
  "notes" = concat_ws(
    E'\n',
    NULLIF("ShiftCashClosure"."notes", ''),
    'Regularización administrativa autorizada el 27/09/2026; se reactiva el cierre previo sin alterar su snapshot.'
  ),
  "reopenedAt" = NULL,
  "reopenedById" = NULL,
  "reopenReason" = NULL;

-- 2) Cerrar todos los turnos operativos heredados hasta la fecha objetivo.
UPDATE "Shift" s
SET
  "status" = 'CERRADO'::"ShiftStatus",
  "actualEnd" = COALESCE(s."actualEnd", LEAST(s."plannedEnd", CURRENT_TIMESTAMP)),
  "closedById" = COALESCE(
    s."closedById",
    (SELECT u."id"
     FROM "User" u
     WHERE lower(u."username") = lower('EHerrera')
       AND u."active" = TRUE
       AND u."deletedAt" IS NULL
     LIMIT 1),
    s."startedById",
    s."createdById",
    (SELECT sa."userId"
     FROM "ShiftAssignment" sa
     WHERE sa."shiftId" = s."id"
     ORDER BY sa."activatedAt" NULLS LAST, sa."createdAt"
     LIMIT 1)
  ),
  "notes" = concat_ws(
    E'\n',
    NULLIF(s."notes", ''),
    'REGULARIZACIÓN ADMINISTRATIVA 27/09/2026: cierre de turno heredado por corrección del flujo de relevo.'
  )
FROM "_repair_target_shifts" t
WHERE s."id" = t."id";

UPDATE "ShiftAssignment" sa
SET "leftAt" = COALESCE(sa."leftAt", s."actualEnd", CURRENT_TIMESTAMP)
FROM "Shift" s
JOIN "_repair_target_shifts" t ON t."id" = s."id"
WHERE sa."shiftId" = s."id"
  AND sa."activatedAt" IS NOT NULL
  AND sa."leftAt" IS NULL;

-- 3) Construir el enlace histórico entre entregas pendientes y el turno
--    cronológicamente siguiente. Esto incluye Yailin NOCHE 26 -> DÍA 27 y
--    Humberto/Jaime DÍA 27 -> Yailin NOCHE 27.
CREATE TEMP TABLE "_repair_handover_links" ON COMMIT DROP AS
SELECT
  h."id" AS "handoverId",
  h."fromShiftId",
  nxt."id" AS "toShiftId",
  COALESCE(
    nxt."startedById",
    (SELECT sa."userId"
     FROM "ShiftAssignment" sa
     WHERE sa."shiftId" = nxt."id"
     ORDER BY
       CASE WHEN sa."role" = 'TITULAR'::"AssignmentRole" THEN 0 ELSE 1 END,
       sa."activatedAt" NULLS LAST,
       sa."createdAt"
     LIMIT 1)
  ) AS "receiverId"
FROM "ShiftHandover" h
JOIN "Shift" src ON src."id" = h."fromShiftId"
JOIN LATERAL (
  SELECT s2.*
  FROM "Shift" s2
  WHERE s2."isDemo" = FALSE
    AND s2."archivedAt" IS NULL
    AND s2."status" <> 'ANULADO'::"ShiftStatus"
    AND s2."actualStart" IS NOT NULL
    AND s2."date" <= DATE '2026-09-27'
    AND s2."id" <> src."id"
    AND s2."actualStart" > COALESCE(src."actualStart", src."plannedStart")
  ORDER BY s2."actualStart" ASC
  LIMIT 1
) nxt ON TRUE
WHERE h."status" = 'ENVIADA'::"HandoverStatus"
  AND h."receivedAt" IS NULL
  AND src."isDemo" = FALSE
  AND src."date" <= DATE '2026-09-27';

-- Refuerzo explícito del relevo pedido: DÍA 27 con Humberto -> NOCHE 27 con Yailin.
UPDATE "_repair_handover_links" l
SET
  "toShiftId" = y."shiftId",
  "receiverId" = y."userId"
FROM (
  SELECT
    ys."id" AS "shiftId",
    yu."id" AS "userId",
    hs."id" AS "sourceShiftId"
  FROM "Shift" hs
  JOIN "ShiftAssignment" hsa ON hsa."shiftId" = hs."id"
  JOIN "User" hu ON hu."id" = hsa."userId"
  JOIN LATERAL (
    SELECT s2.*
    FROM "Shift" s2
    JOIN "ShiftAssignment" ysa ON ysa."shiftId" = s2."id"
    JOIN "User" yu2 ON yu2."id" = ysa."userId"
    WHERE s2."date" = DATE '2026-09-27'
      AND s2."type" = 'NOCHE'::"ShiftType"
      AND s2."isDemo" = FALSE
      AND lower(yu2."name") LIKE '%yailin%'
    ORDER BY s2."actualStart" DESC NULLS LAST, s2."createdAt" DESC
    LIMIT 1
  ) ys ON TRUE
  JOIN "ShiftAssignment" ysa2 ON ysa2."shiftId" = ys."id"
  JOIN "User" yu ON yu."id" = ysa2."userId" AND lower(yu."name") LIKE '%yailin%'
  WHERE hs."date" = DATE '2026-09-27'
    AND hs."type" = 'DIA'::"ShiftType"
    AND hs."isDemo" = FALSE
    AND lower(hu."name") LIKE '%humberto%'
  ORDER BY hs."actualStart" DESC NULLS LAST
  LIMIT 1
) y
WHERE l."fromShiftId" = y."sourceShiftId";

UPDATE "ShiftHandover" h
SET
  "status" = 'RECIBIDA'::"HandoverStatus",
  "toShiftId" = l."toShiftId",
  "receivedById" = l."receiverId",
  "receivedAt" = CURRENT_TIMESTAMP,
  "receiverObservations" = concat_ws(
    E'\n',
    NULLIF(h."receiverObservations", ''),
    'REGULARIZACIÓN ADMINISTRATIVA 27/09/2026: relevo histórico enlazado al turno que continuó la operación. No representa un nuevo recuento físico retroactivo.'
  )
FROM "_repair_handover_links" l
WHERE h."id" = l."handoverId"
  AND l."receiverId" IS NOT NULL;

-- La última entrega sin un turno posterior no debe seguir bloqueando una nueva
-- apertura. Se conserva como anulada, con motivo auditable; los pendientes del
-- Libro permanecen vivos por sus propias entidades.
UPDATE "ShiftHandover" h
SET
  "status" = 'ANULADA'::"HandoverStatus",
  "notes" = concat_ws(
    E'\n',
    NULLIF(h."notes", ''),
    'REGULARIZACIÓN ADMINISTRATIVA 27/09/2026: entrega cerrada sin receptor posterior para reiniciar el ciclo normal.'
  )
FROM "Shift" src
WHERE h."fromShiftId" = src."id"
  AND src."isDemo" = FALSE
  AND src."date" <= DATE '2026-09-27'
  AND h."status" = 'ENVIADA'::"HandoverStatus"
  AND h."receivedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "_repair_handover_links" l
    WHERE l."handoverId" = h."id"
      AND l."receiverId" IS NOT NULL
  );

UPDATE "ShiftHandover" h
SET
  "status" = 'ANULADA'::"HandoverStatus",
  "notes" = concat_ws(
    E'\n',
    NULLIF(h."notes", ''),
    'REGULARIZACIÓN ADMINISTRATIVA 27/09/2026: borrador heredado descartado tras cierre administrativo.'
  )
FROM "_repair_target_shifts" t
WHERE h."fromShiftId" = t."id"
  AND h."status" = 'BORRADOR'::"HandoverStatus";

-- 4) Resolver las validaciones de los turnos 26–27/09 bajo la autorización
--    expresa de Supervisión. La tarea vinculada se valida junto con la alerta.
UPDATE "Alert" a
SET
  "status" = 'RESUELTA'::"AlertStatus",
  "resolvedById" = COALESCE(
    (SELECT u."id"
     FROM "User" u
     WHERE lower(u."username") = lower('EHerrera')
       AND u."active" = TRUE
       AND u."deletedAt" IS NULL
     LIMIT 1),
    a."resolvedById"
  ),
  "resolvedAt" = COALESCE(a."resolvedAt", CURRENT_TIMESTAMP),
  "resolutionNote" = concat_ws(
    E'\n',
    NULLIF(a."resolutionNote", ''),
    'Validación administrativa autorizada el 27/09/2026 tras regularizar el ciclo de relevo.'
  ),
  "snoozedUntil" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Shift" s
WHERE a."dedupeKey" = 'shift-validation:' || s."id"
  AND s."isDemo" = FALSE
  AND s."date" BETWEEN DATE '2026-09-26' AND DATE '2026-09-27';

UPDATE "Task" t
SET
  "status" = 'VALIDADA'::"TaskStatus",
  "validatedAt" = COALESCE(t."validatedAt", CURRENT_TIMESTAMP),
  "validatedById" = COALESCE(
    (SELECT u."id"
     FROM "User" u
     WHERE lower(u."username") = lower('EHerrera')
       AND u."active" = TRUE
       AND u."deletedAt" IS NULL
     LIMIT 1),
    t."validatedById"
  ),
  "completedAt" = COALESCE(t."completedAt", CURRENT_TIMESTAMP),
  "completedById" = COALESCE(
    t."completedById",
    (SELECT u."id"
     FROM "User" u
     WHERE lower(u."username") = lower('EHerrera')
       AND u."active" = TRUE
       AND u."deletedAt" IS NULL
     LIMIT 1)
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Alert" a, "Shift" s
WHERE t."alertId" = a."id"
  AND a."dedupeKey" = 'shift-validation:' || s."id"
  AND s."isDemo" = FALSE
  AND s."date" BETWEEN DATE '2026-09-26' AND DATE '2026-09-27'
  AND t."deletedAt" IS NULL
  AND t."status" <> 'CANCELADA'::"TaskStatus";

-- La emergencia deja de estar activa cuando el turno fuente ya quedó cerrado.
UPDATE "Alert" a
SET
  "status" = 'RESUELTA'::"AlertStatus",
  "resolvedById" = COALESCE(
    (SELECT u."id"
     FROM "User" u
     WHERE lower(u."username") = lower('EHerrera')
       AND u."active" = TRUE
       AND u."deletedAt" IS NULL
     LIMIT 1),
    a."resolvedById"
  ),
  "resolvedAt" = COALESCE(a."resolvedAt", CURRENT_TIMESTAMP),
  "resolutionNote" = concat_ws(
    E'\n',
    NULLIF(a."resolutionNote", ''),
    'Emergencia regularizada: el turno fuente quedó formalmente cerrado.'
  ),
  "snoozedUntil" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Shift" s
WHERE a."dedupeKey" = 'shift-emergency-source:' || s."id"
  AND s."status" = 'CERRADO'::"ShiftStatus"
  AND s."isDemo" = FALSE
  AND s."date" <= DATE '2026-09-27';

-- 5) Auditoría explícita de la reparación.
INSERT INTO "AuditLog" (
  "id", "entity", "entityId", "action", "summary", "userId",
  "after", "reason", "createdAt", "isDemo"
)
SELECT
  gen_random_uuid()::text,
  'Shift',
  s."id",
  'TURNO_CERRAR'::"AuditAction",
  'Regularización administrativa: turno heredado cerrado el 27/09/2026',
  (SELECT u."id"
   FROM "User" u
   WHERE lower(u."username") = lower('EHerrera')
     AND u."active" = TRUE
     AND u."deletedAt" IS NULL
   LIMIT 1),
  jsonb_build_object(
    'status', s."status"::text,
    'actualEnd', s."actualEnd",
    'administrativeRegularization', TRUE
  ),
  'Corrección autorizada del ciclo de cierre/recepción; no sustituye un recuento físico retroactivo.',
  CURRENT_TIMESTAMP,
  FALSE
FROM "Shift" s
JOIN "_repair_target_shifts" t ON t."id" = s."id";

INSERT INTO "AuditLog" (
  "id", "entity", "entityId", "action", "summary", "userId",
  "after", "reason", "createdAt", "isDemo"
)
SELECT
  gen_random_uuid()::text,
  'ShiftHandover',
  h."id",
  'TURNO_RECIBIR'::"AuditAction",
  'Regularización administrativa: entrega histórica enlazada al turno receptor',
  (SELECT u."id"
   FROM "User" u
   WHERE lower(u."username") = lower('EHerrera')
     AND u."active" = TRUE
     AND u."deletedAt" IS NULL
   LIMIT 1),
  jsonb_build_object(
    'status', h."status"::text,
    'toShiftId', h."toShiftId",
    'receivedById', h."receivedById",
    'administrativeRegularization', TRUE
  ),
  'La recepción se enlaza para restablecer trazabilidad; no declara un nuevo conteo físico.',
  CURRENT_TIMESTAMP,
  FALSE
FROM "ShiftHandover" h
JOIN "_repair_handover_links" l ON l."handoverId" = h."id"
WHERE h."status" = 'RECIBIDA'::"HandoverStatus";

INSERT INTO "SystemSetting" (
  "id", "key", "value", "category", "description", "updatedById", "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'maintenance.regularizacionTurnos20260927',
  jsonb_build_object(
    'executedAt', CURRENT_TIMESTAMP,
    'closedShifts', (SELECT count(*) FROM "_repair_target_shifts"),
    'linkedHandovers', (
      SELECT count(*)
      FROM "_repair_handover_links" l
      JOIN "ShiftHandover" h ON h."id" = l."handoverId"
      WHERE h."status" = 'RECIBIDA'::"HandoverStatus"
    ),
    'scope', 'Recepción 26–27/09/2026'
  ),
  'mantenimiento',
  'Marca auditable de la regularización extraordinaria del ciclo de turnos del 27/09/2026.',
  (SELECT u."id"
   FROM "User" u
   WHERE lower(u."username") = lower('EHerrera')
     AND u."active" = TRUE
     AND u."deletedAt" IS NULL
   LIMIT 1),
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "value" = EXCLUDED."value",
  "description" = EXCLUDED."description",
  "updatedById" = EXCLUDED."updatedById",
  "updatedAt" = CURRENT_TIMESTAMP;

COMMIT;
