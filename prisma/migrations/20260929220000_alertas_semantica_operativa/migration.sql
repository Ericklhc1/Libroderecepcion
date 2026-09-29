-- AROH 1.33.0 · semántica de alertas y tareas programables
--
-- OperationalAlarm pasa a ser la alerta programable visible para usuarios.
-- Alert queda como señal interna/legada y deja de ser la representación automática
-- de novedades, tareas o seguimientos.

ALTER TABLE "Task"
  ADD COLUMN "startsAt" TIMESTAMP(3);

CREATE INDEX "Task_startsAt_idx" ON "Task"("startsAt");

ALTER TABLE "OperationalAlarm"
  ADD COLUMN "sourceEntity" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "sourceLink" TEXT,
  ADD COLUMN "repeatMinutes" INTEGER;

CREATE INDEX "OperationalAlarm_sourceEntity_sourceId_status_idx"
  ON "OperationalAlarm"("sourceEntity", "sourceId", "status");

-- Las alertas que el motor antiguo creó automáticamente dejan de quedar abiertas.
-- Se conserva todo el historial y su ID para auditoría.
UPDATE "Alert"
SET
  "status" = 'RESUELTA'::"AlertStatus",
  "resolvedAt" = COALESCE("resolvedAt", CURRENT_TIMESTAMP),
  "resolutionNote" = COALESCE(
    "resolutionNote",
    'Cerrada por migración AROH 1.33.0: la condición se representa ahora en su objeto original.'
  )
WHERE "auto" = TRUE
  AND "deletedAt" IS NULL
  AND "status" <> 'RESUELTA'::"AlertStatus";
