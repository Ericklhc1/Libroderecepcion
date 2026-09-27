CREATE TYPE "OperationalMailStatus" AS ENUM ('PENDIENTE', 'ENVIADO', 'ERROR');

CREATE TABLE "OperationalMailOutbox" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "recipients" TEXT[] NOT NULL,
  "subject" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "status" "OperationalMailStatus" NOT NULL DEFAULT 'PENDIENTE',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalMailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalMailOutbox_eventKey_key"
  ON "OperationalMailOutbox"("eventKey");
CREATE INDEX "OperationalMailOutbox_status_nextAttemptAt_idx"
  ON "OperationalMailOutbox"("status", "nextAttemptAt");
CREATE INDEX "OperationalMailOutbox_createdAt_idx"
  ON "OperationalMailOutbox"("createdAt");
