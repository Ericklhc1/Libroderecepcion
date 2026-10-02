-- Add finite mandates to the existing executor. No operational data or enabled policy.
ALTER TABLE "FrontiExecution"
  ADD COLUMN "authorizationKind" TEXT NOT NULL DEFAULT 'ONE_SHOT',
  ADD COLUMN "availableAt" TIMESTAMP(3),
  ADD COLUMN "objective" TEXT;
ALTER TABLE "FrontiExecution" ADD CONSTRAINT "FrontiExecution_authorization_kind_check"
  CHECK ("authorizationKind" IN ('ONE_SHOT', 'DELEGATION'));
ALTER TABLE "FrontiExecution" ADD CONSTRAINT "FrontiExecution_delegation_window_check"
  CHECK ("authorizationKind" <> 'DELEGATION' OR (
    "availableAt" IS NOT NULL AND "objective" IS NOT NULL AND "authorizedAt" IS NOT NULL
    AND "expiresAt" > "availableAt"
    AND "expiresAt" <= "availableAt" + INTERVAL '31 days'
  ));
