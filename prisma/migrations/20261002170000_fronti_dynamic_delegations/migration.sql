ALTER TABLE "FrontiExecution" ADD COLUMN "delegationPolicy" TEXT, ADD COLUMN "parentDelegationId" TEXT, ADD COLUMN "reservedMinorUnits" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "FrontiExecution_parentDelegationId_idx" ON "FrontiExecution"("parentDelegationId");
ALTER TABLE "FrontiExecution" ADD CONSTRAINT "FrontiExecution_parentDelegationId_fkey" FOREIGN KEY ("parentDelegationId") REFERENCES "FrontiExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
