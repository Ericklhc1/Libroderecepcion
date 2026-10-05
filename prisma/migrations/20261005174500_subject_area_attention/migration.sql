-- Additive workflow metadata. No historical completion dates are invented.
ALTER TABLE "OperationalEntry" ADD COLUMN "resolvedAt" TIMESTAMP(3);
-- One native specialized intervention per area; the original source remains canonical.
-- The global unique index remains during the compatible-reader release.
-- Only a later, authorized activation migration may drop it after recovery is verified.
CREATE UNIQUE INDEX "HousekeepingRequest_sourceEntryId_departmentId_key" ON "HousekeepingRequest"("sourceEntryId", "departmentId");
-- Preserve one unscoped historical/pilot link, where PostgreSQL NULL is not equal.
CREATE UNIQUE INDEX "HousekeepingRequest_unscoped_source_key" ON "HousekeepingRequest"("sourceEntryId") WHERE "departmentId" IS NULL;
CREATE TABLE "SubjectAreaAttention" (
  "id" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "entryId" TEXT NOT NULL, "departmentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POR_REVISAR', "urgent" BOOLEAN NOT NULL DEFAULT false,
  "urgencyReason" TEXT, "urgentContactId" TEXT, "requiresValidation" BOOLEAN NOT NULL DEFAULT false,
  "location" TEXT, "createdById" TEXT NOT NULL, "knownAt" TIMESTAMP(3), "knownById" TEXT,
  "decisionAt" TIMESTAMP(3), "decidedById" TEXT, "decisionNote" TEXT,
  "taskId" TEXT, "housekeepingId" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubjectAreaAttention_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubjectAreaAttention_status_check" CHECK ("status" IN ('POR_REVISAR','ACLARACION','INFORMADA','ASIGNADA')),
  CONSTRAINT "SubjectAreaAttention_single_work_check" CHECK ("taskId" IS NULL OR "housekeepingId" IS NULL),
  CONSTRAINT "SubjectAreaAttention_urgency_check" CHECK (NOT "urgent" OR length(trim("urgencyReason")) > 0)
);
CREATE UNIQUE INDEX "SubjectAreaAttention_requestKey_key" ON "SubjectAreaAttention"("requestKey");
CREATE UNIQUE INDEX "SubjectAreaAttention_entryId_departmentId_key" ON "SubjectAreaAttention"("entryId","departmentId");
CREATE UNIQUE INDEX "SubjectAreaAttention_taskId_key" ON "SubjectAreaAttention"("taskId");
CREATE UNIQUE INDEX "SubjectAreaAttention_housekeepingId_key" ON "SubjectAreaAttention"("housekeepingId");
CREATE INDEX "SubjectAreaAttention_departmentId_status_idx" ON "SubjectAreaAttention"("departmentId","status");
CREATE INDEX "SubjectAreaAttention_urgentContactId_idx" ON "SubjectAreaAttention"("urgentContactId");
ALTER TABLE "SubjectAreaAttention" ADD CONSTRAINT "SubjectAreaAttention_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "OperationalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubjectAreaAttention" ADD CONSTRAINT "SubjectAreaAttention_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubjectAreaAttention" ADD CONSTRAINT "SubjectAreaAttention_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubjectAreaAttention" ADD CONSTRAINT "SubjectAreaAttention_housekeepingId_fkey" FOREIGN KEY ("housekeepingId") REFERENCES "HousekeepingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Audit actor identifiers are additionally constrained without introducing back-reference APIs.
ALTER TABLE "SubjectAreaAttention" ADD CONSTRAINT "SubjectAreaAttention_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubjectAreaAttention" ADD CONSTRAINT "SubjectAreaAttention_knownById_fkey" FOREIGN KEY ("knownById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubjectAreaAttention" ADD CONSTRAINT "SubjectAreaAttention_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubjectAreaAttention" ADD CONSTRAINT "SubjectAreaAttention_urgentContactId_fkey" FOREIGN KEY ("urgentContactId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
