-- Excepción física explícita; nunca equivale a confirmar posesión.
ALTER TABLE "HandoverElement"
 ADD COLUMN "missingReason" TEXT,
 ADD COLUMN "missingReportedById" TEXT,
 ADD COLUMN "missingReportedAt" TIMESTAMP(3),
 ADD COLUMN "missingApprovedById" TEXT,
 ADD COLUMN "missingApprovedByName" TEXT,
 ADD COLUMN "missingApprovedAt" TIMESTAMP(3),
 ADD COLUMN "missingApprovalNote" TEXT;
ALTER TABLE "HandoverElement" ADD CONSTRAINT "HandoverElement_missing_truth_check" CHECK (
 ("missingReason" IS NULL AND "missingReportedById" IS NULL AND "missingReportedAt" IS NULL
  AND "missingApprovedById" IS NULL AND "missingApprovedByName" IS NULL AND "missingApprovedAt" IS NULL AND "missingApprovalNote" IS NULL)
 OR
 ("missingReason" IS NOT NULL AND "declared" AND NOT "confirmed" AND length(trim("missingReason")) BETWEEN 5 AND 500
  AND "missingReportedById" IS NOT NULL AND "missingReportedAt" IS NOT NULL
  AND (("missingApprovedById" IS NULL AND "missingApprovedByName" IS NULL AND "missingApprovedAt" IS NULL AND "missingApprovalNote" IS NULL)
   OR ("missingApprovedById" IS NOT NULL AND "missingApprovedByName" IS NOT NULL AND "missingApprovedAt" IS NOT NULL
    AND "missingApprovalNote" IS NOT NULL AND "missingApprovedById" <> "missingReportedById" AND length(trim("missingApprovalNote")) BETWEEN 5 AND 500)))
);
