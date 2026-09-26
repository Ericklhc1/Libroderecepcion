-- Observabilidad operativa P0: tabla aditiva y no destructiva.
-- No contiene claves foráneas a propósito: la telemetría no debe bloquear
-- operaciones, reparaciones ni ciclos de vida de los datos canónicos.

CREATE TABLE "OperationalMetricEvent" (
    "id" TEXT NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "userId" TEXT,
    "shiftId" TEXT,
    "entityType" VARCHAR(64),
    "entityId" TEXT,
    "correlationId" VARCHAR(128),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "status" VARCHAR(24) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalMetricEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationalMetricEvent_eventType_createdAt_idx"
    ON "OperationalMetricEvent"("eventType", "createdAt");

CREATE INDEX "OperationalMetricEvent_createdAt_idx"
    ON "OperationalMetricEvent"("createdAt");

CREATE INDEX "OperationalMetricEvent_userId_createdAt_idx"
    ON "OperationalMetricEvent"("userId", "createdAt");

CREATE INDEX "OperationalMetricEvent_shiftId_createdAt_idx"
    ON "OperationalMetricEvent"("shiftId", "createdAt");

CREATE INDEX "OperationalMetricEvent_correlationId_createdAt_idx"
    ON "OperationalMetricEvent"("correlationId", "createdAt");
