CREATE TABLE "SupervisionAuditImport" (
  "id" TEXT NOT NULL,
  "supervisionShiftId" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "reportKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "metrics" JSONB NOT NULL,
  "checks" JSONB NOT NULL,
  "findings" JSONB NOT NULL,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupervisionAuditImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupervisionAuditImport_supervisionShiftId_businessDate_key"
  ON "SupervisionAuditImport"("supervisionShiftId", "businessDate");
CREATE INDEX "SupervisionAuditImport_businessDate_idx"
  ON "SupervisionAuditImport"("businessDate");
CREATE INDEX "SupervisionAuditImport_uploadedById_createdAt_idx"
  ON "SupervisionAuditImport"("uploadedById", "createdAt");

ALTER TABLE "SupervisionAuditImport"
  ADD CONSTRAINT "SupervisionAuditImport_supervisionShiftId_fkey"
  FOREIGN KEY ("supervisionShiftId") REFERENCES "SupervisionShift"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupervisionAuditImport"
  ADD CONSTRAINT "SupervisionAuditImport_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
