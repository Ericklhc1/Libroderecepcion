ALTER TABLE "SupervisionAuditImport"
ADD COLUMN IF NOT EXISTS "reviewState" JSONB NOT NULL DEFAULT '{}'::jsonb;
