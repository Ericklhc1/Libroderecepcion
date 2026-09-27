-- Timers/reminders + respaldo de correo operativo.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ALARMA';

CREATE TYPE "AlarmKind" AS ENUM ('TIMER', 'REMINDER');
CREATE TYPE "AlarmScope" AS ENUM ('INDIVIDUAL', 'GRUPO', 'GLOBAL');
CREATE TYPE "AlarmStatus" AS ENUM ('ACTIVA', 'COMPLETADA', 'CANCELADA');
CREATE TYPE "MailOutboxStatus" AS ENUM ('PENDIENTE', 'ENVIADO', 'ERROR');

CREATE TABLE "Alarm" (
  "id" TEXT NOT NULL,
  "kind" "AlarmKind" NOT NULL,
  "scope" "AlarmScope" NOT NULL,
  "status" "AlarmStatus" NOT NULL DEFAULT 'ACTIVA',
  "title" TEXT NOT NULL,
  "note" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "sourceShiftId" TEXT,
  "sourceSupervisionShiftId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Alarm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlarmRecipient" (
  "id" TEXT NOT NULL,
  "alarmId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "triggeredAt" TIMESTAMP(3),
  "lastNotifiedAt" TIMESTAMP(3),
  "snoozedUntil" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlarmRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalMailOutbox" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "MailOutboxStatus" NOT NULL DEFAULT 'PENDIENTE',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalMailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlarmRecipient_alarmId_userId_key" ON "AlarmRecipient"("alarmId","userId");
CREATE INDEX "Alarm_status_dueAt_idx" ON "Alarm"("status","dueAt");
CREATE INDEX "Alarm_createdById_createdAt_idx" ON "Alarm"("createdById","createdAt");
CREATE INDEX "Alarm_sourceShiftId_status_idx" ON "Alarm"("sourceShiftId","status");
CREATE INDEX "Alarm_sourceSupervisionShiftId_status_idx" ON "Alarm"("sourceSupervisionShiftId","status");
CREATE INDEX "AlarmRecipient_userId_acknowledgedAt_cancelledAt_idx" ON "AlarmRecipient"("userId","acknowledgedAt","cancelledAt");
CREATE INDEX "AlarmRecipient_snoozedUntil_idx" ON "AlarmRecipient"("snoozedUntil");
CREATE UNIQUE INDEX "OperationalMailOutbox_eventKey_key" ON "OperationalMailOutbox"("eventKey");
CREATE INDEX "OperationalMailOutbox_status_nextAttemptAt_idx" ON "OperationalMailOutbox"("status","nextAttemptAt");
CREATE INDEX "OperationalMailOutbox_createdAt_idx" ON "OperationalMailOutbox"("createdAt");

ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_sourceShiftId_fkey"
  FOREIGN KEY ("sourceShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_sourceSupervisionShiftId_fkey"
  FOREIGN KEY ("sourceSupervisionShiftId") REFERENCES "SupervisionShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AlarmRecipient" ADD CONSTRAINT "AlarmRecipient_alarmId_fkey"
  FOREIGN KEY ("alarmId") REFERENCES "Alarm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlarmRecipient" ADD CONSTRAINT "AlarmRecipient_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
