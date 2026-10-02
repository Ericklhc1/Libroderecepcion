ALTER TABLE "FrontiExecution" ADD COLUMN "delegationPolicy" TEXT, ADD COLUMN "parentDelegationId" TEXT, ADD COLUMN "reservedMinorUnits" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "FrontiExecution_parentDelegationId_idx" ON "FrontiExecution"("parentDelegationId");
ALTER TABLE "FrontiExecution" ADD CONSTRAINT "FrontiExecution_parentDelegationId_fkey" FOREIGN KEY ("parentDelegationId") REFERENCES "FrontiExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Preserve authorization invariants while adding the two explicit mandate types.
ALTER TABLE "FrontiExecution" DROP CONSTRAINT "FrontiExecution_authorization_kind_check";
ALTER TABLE "FrontiExecution" ADD CONSTRAINT "FrontiExecution_authorization_kind_check"
  CHECK ("authorizationKind" IN ('ONE_SHOT','DELEGATION','DYNAMIC','DELEGATED_USE'));
ALTER TABLE "FrontiExecution" ADD CONSTRAINT "FrontiExecution_dynamic_window_check"
  CHECK ("authorizationKind" <> 'DYNAMIC' OR (
    "delegationPolicy" IS NOT NULL AND "availableAt" IS NOT NULL AND "objective" IS NOT NULL
    AND "authorizedAt" IS NOT NULL AND "expiresAt" > "availableAt"
    AND "expiresAt" <= "availableAt" + INTERVAL '31 days'
  ));
ALTER TABLE "FrontiExecution" ADD CONSTRAINT "FrontiExecution_delegated_use_check"
  CHECK (("authorizationKind" = 'DELEGATED_USE') = ("parentDelegationId" IS NOT NULL)
    AND "reservedMinorUnits" >= 0 AND "reservedMinorUnits" <= 1000000000
    AND ("authorizationKind" <> 'DELEGATED_USE' OR "authorizedAt" IS NOT NULL));
