-- Additive receipt metadata on canonical work; no operational records are copied.
ALTER TABLE "OperationalEntry"
 ADD COLUMN "workAssignedAt" TIMESTAMP(3), ADD COLUMN "workAcknowledgedAt" TIMESTAMP(3),
 ADD COLUMN "workAcknowledgedById" TEXT, ADD COLUMN "workStartedAt" TIMESTAMP(3),
 ADD COLUMN "workNextAction" TEXT, ADD COLUMN "workEscalatedAt" TIMESTAMP(3), ADD COLUMN "workRequestKey" TEXT;
ALTER TABLE "Task"
 ADD COLUMN "workAssignedAt" TIMESTAMP(3), ADD COLUMN "workAcknowledgedAt" TIMESTAMP(3),
 ADD COLUMN "workAcknowledgedById" TEXT, ADD COLUMN "workStartedAt" TIMESTAMP(3),
 ADD COLUMN "workNextAction" TEXT, ADD COLUMN "workEscalatedAt" TIMESTAMP(3), ADD COLUMN "workRequestKey" TEXT;
ALTER TABLE "HousekeepingHandover" ADD COLUMN "acceptedAt" TIMESTAMP(3), ADD COLUMN "acceptedById" TEXT;
-- Historical assignments are intentionally not backfilled as received or started.

ALTER TABLE "HousekeepingRequest" ADD COLUMN "workAssignedAt" TIMESTAMP(3);
CREATE INDEX "Task_pending_receipt_idx" ON "Task" ("workAssignedAt") WHERE "workAcknowledgedAt" IS NULL AND "workEscalatedAt" IS NULL AND "deletedAt" IS NULL AND "isDemo" = false;
CREATE INDEX "OperationalEntry_pending_receipt_idx" ON "OperationalEntry" ("workAssignedAt") WHERE "workAcknowledgedAt" IS NULL AND "workEscalatedAt" IS NULL AND "deletedAt" IS NULL AND "isDemo" = false;
CREATE INDEX "HousekeepingRequest_pending_receipt_idx" ON "HousekeepingRequest" ("workAssignedAt") WHERE "acknowledgedAt" IS NULL AND "isDemo" = false;
