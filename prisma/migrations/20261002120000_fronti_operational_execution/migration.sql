-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "procedureOccurrenceKey" TEXT,
ADD COLUMN     "requiresIndependentValidation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FrontiExecution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "authorizedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrontiExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrontiExecutionStep" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "revision" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FrontiExecutionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalAutomation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configuration" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastEvaluatedAt" TIMESTAMP(3),

    CONSTRAINT "OperationalAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalAutomationRun" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "occurrence" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OperationalAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrontiExecutionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrontiExecutionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FrontiExecution_userId_createdAt_idx" ON "FrontiExecution"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FrontiExecution_userId_requestKey_key" ON "FrontiExecution"("userId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "FrontiExecutionStep_executionId_position_key" ON "FrontiExecutionStep"("executionId", "position");

-- CreateIndex
CREATE INDEX "OperationalAutomation_enabled_expiresAt_idx" ON "OperationalAutomation"("enabled", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalAutomationRun_policyId_occurrence_key" ON "OperationalAutomationRun"("policyId", "occurrence");

-- CreateIndex
CREATE UNIQUE INDEX "FrontiExecutionRequest_userId_requestKey_key" ON "FrontiExecutionRequest"("userId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Task_procedureOccurrenceKey_key" ON "Task"("procedureOccurrenceKey");

-- AddForeignKey
ALTER TABLE "FrontiExecution" ADD CONSTRAINT "FrontiExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrontiExecutionStep" ADD CONSTRAINT "FrontiExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "FrontiExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAutomation" ADD CONSTRAINT "OperationalAutomation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAutomation" ADD CONSTRAINT "OperationalAutomation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAutomationRun" ADD CONSTRAINT "OperationalAutomationRun_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "OperationalAutomation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrontiExecutionRequest" ADD CONSTRAINT "FrontiExecutionRequest_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "FrontiExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

