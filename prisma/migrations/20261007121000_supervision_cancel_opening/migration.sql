-- Additive: canceled preparations keep all evidence and references.
ALTER TYPE "SupervisionShiftStatus" ADD VALUE IF NOT EXISTS 'CANCELADO';
ALTER TABLE "SupervisionShift" ADD COLUMN "canceledAt" TIMESTAMP(3), ADD COLUMN "canceledById" TEXT, ADD COLUMN "cancellationReason" TEXT;
