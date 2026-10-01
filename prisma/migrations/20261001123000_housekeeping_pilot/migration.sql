-- Additive private pilot. No operational records, roles or assignments changed.
CREATE TABLE "HousekeepingRequest" (
  "id" TEXT NOT NULL,
  "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass),
  "requestKey" TEXT NOT NULL,
  "sourceEntryId" TEXT,
  "title" TEXT,
  "description" TEXT,
  "location" TEXT,
  "priority" "Priority" NOT NULL DEFAULT 'MEDIA',
  "status" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "dueAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "sourceVersion" TIMESTAMP(3),
  "blockReason" TEXT,
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "isDemo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HousekeepingRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HousekeepingRequest_status_check" CHECK ("status" IN ('PENDIENTE','RECIBIDO','EN_GESTION','BLOQUEADO','RESUELTO','CANCELADO')),
  CONSTRAINT "HousekeepingRequest_pilot_check" CHECK ("isDemo" = true),
  CONSTRAINT "HousekeepingRequest_content_check" CHECK ("sourceEntryId" IS NOT NULL OR (length(trim(coalesce("title", ''))) > 0 AND length(trim(coalesce("description", ''))) > 0)),
  CONSTRAINT "HousekeepingRequest_version_check" CHECK ("version" > 0),
  CONSTRAINT "HousekeepingRequest_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "OperationalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HousekeepingRequest_humanId_key" ON "HousekeepingRequest"("humanId");
CREATE UNIQUE INDEX "HousekeepingRequest_requestKey_key" ON "HousekeepingRequest"("requestKey");
CREATE UNIQUE INDEX "HousekeepingRequest_sourceEntryId_key" ON "HousekeepingRequest"("sourceEntryId");
CREATE INDEX "HousekeepingRequest_status_dueAt_idx" ON "HousekeepingRequest"("status", "dueAt");

CREATE TABLE "HousekeepingEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HousekeepingEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HousekeepingEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HousekeepingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HousekeepingEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HousekeepingEvent_requestId_createdAt_idx" ON "HousekeepingEvent"("requestId", "createdAt");
