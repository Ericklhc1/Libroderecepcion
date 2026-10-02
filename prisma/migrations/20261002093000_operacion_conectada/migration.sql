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
