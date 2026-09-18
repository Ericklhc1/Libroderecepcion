-- Turnos solapados: la exclusividad deja de ser global por hotel y pasa a
-- ser por participación activa de cada persona.

ALTER TABLE "ShiftAssignment"
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "leftAt" TIMESTAMP(3);

-- Participaciones actualmente en curso. El índice global antiguo garantizaba
-- que, antes de esta migración, no podía haber dos turnos de estos estados.
UPDATE "ShiftAssignment" AS sa
SET
  "activatedAt" = COALESCE(s."actualStart", sa."createdAt"),
  "leftAt" = NULL
FROM "Shift" AS s
WHERE sa."shiftId" = s."id"
  AND s."status" IN ('INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA');

-- Turnos que ya enviaron la entrega: desde ese instante la participación dejó
-- de ser activa aunque el cierre formal o la recepción ocurrieran después.
UPDATE "ShiftAssignment" AS sa
SET
  "activatedAt" = COALESCE(s."actualStart", sa."createdAt"),
  "leftAt" = COALESCE(h."issuedAt", s."actualEnd", s."updatedAt", sa."createdAt")
FROM "Shift" AS s
LEFT JOIN "ShiftHandover" AS h ON h."fromShiftId" = s."id"
WHERE sa."shiftId" = s."id"
  AND s."status" = 'ENTREGA_ENVIADA';

-- Históricos finalizados que sí llegaron a iniciar.
UPDATE "ShiftAssignment" AS sa
SET
  "activatedAt" = COALESCE(s."actualStart", sa."createdAt"),
  "leftAt" = COALESCE(
    s."actualEnd",
    h."receivedAt",
    h."issuedAt",
    s."updatedAt",
    sa."createdAt"
  )
FROM "Shift" AS s
LEFT JOIN "ShiftHandover" AS h ON h."fromShiftId" = s."id"
WHERE sa."shiftId" = s."id"
  AND s."status" IN ('RECIBIDO', 'CERRADO')
  AND s."actualStart" IS NOT NULL;

-- Un turno anulado que alcanzó a iniciar conserva su historia; uno que nunca
-- arrancó sigue siendo sólo una asignación programada.
UPDATE "ShiftAssignment" AS sa
SET
  "activatedAt" = COALESCE(s."actualStart", sa."createdAt"),
  "leftAt" = COALESCE(s."actualEnd", s."updatedAt", sa."createdAt")
FROM "Shift" AS s
WHERE sa."shiftId" = s."id"
  AND s."status" = 'ANULADO'
  AND s."actualStart" IS NOT NULL;

DROP INDEX IF EXISTS "Shift_un_solo_turno_en_curso";

CREATE UNIQUE INDEX "ShiftAssignment_una_participacion_activa_por_usuario"
  ON "ShiftAssignment" ("userId")
  WHERE "activatedAt" IS NOT NULL AND "leftAt" IS NULL;
