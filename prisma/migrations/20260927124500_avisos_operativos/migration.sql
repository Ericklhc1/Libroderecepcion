ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ALARMA';

CREATE TYPE "OperationalAlarmKind" AS ENUM ('TIMER', 'RECORDATORIO');
CREATE TYPE "OperationalAlarmScope" AS ENUM ('INDIVIDUAL', 'GRUPO', 'GLOBAL');
CREATE TYPE "OperationalAlarmStatus" AS ENUM ('ACTIVA', 'CANCELADA', 'CERRADA');
CREATE TYPE "OperationalMailStatus" AS ENUM ('PENDIENTE', 'ENVIADO', 'ERROR');

CREATE TABLE "OperationalAlarm" (
  "id" TEXT NOT NULL,
  "kind" "OperationalAlarmKind" NOT NULL,
  "scope" "OperationalAlarmScope" NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "originShiftId" TEXT,
  "status" "OperationalAlarmStatus" NOT NULL DEFAULT 'ACTIVA',
  "cancelledAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalAlarm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalAlarmRecipient" (
  "id" TEXT NOT NULL,
  "alarmId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "snoozedUntil" TIMESTAMP(3),
  "lastTriggeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalAlarmRecipient_pkey" PRIMARY KEY ("id")
);

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

CREATE UNIQUE INDEX "OperationalAlarmRecipient_alarmId_userId_key"
  ON "OperationalAlarmRecipient"("alarmId", "userId");
CREATE INDEX "OperationalAlarm_status_dueAt_idx"
  ON "OperationalAlarm"("status", "dueAt");
CREATE INDEX "OperationalAlarm_originShiftId_status_idx"
  ON "OperationalAlarm"("originShiftId", "status");
CREATE INDEX "OperationalAlarm_createdById_createdAt_idx"
  ON "OperationalAlarm"("createdById", "createdAt");
CREATE INDEX "OperationalAlarmRecipient_userId_acknowledgedAt_snoozedUntil_idx"
  ON "OperationalAlarmRecipient"("userId", "acknowledgedAt", "snoozedUntil");
CREATE UNIQUE INDEX "OperationalMailOutbox_eventKey_key"
  ON "OperationalMailOutbox"("eventKey");
CREATE INDEX "OperationalMailOutbox_status_nextAttemptAt_idx"
  ON "OperationalMailOutbox"("status", "nextAttemptAt");
CREATE INDEX "OperationalMailOutbox_createdAt_idx"
  ON "OperationalMailOutbox"("createdAt");

ALTER TABLE "OperationalAlarm"
  ADD CONSTRAINT "OperationalAlarm_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalAlarm"
  ADD CONSTRAINT "OperationalAlarm_originShiftId_fkey"
  FOREIGN KEY ("originShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalAlarmRecipient"
  ADD CONSTRAINT "OperationalAlarmRecipient_alarmId_fkey"
  FOREIGN KEY ("alarmId") REFERENCES "OperationalAlarm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalAlarmRecipient"
  ADD CONSTRAINT "OperationalAlarmRecipient_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
