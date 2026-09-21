-- Centro de Supervisión: ampliación aditiva. No elimina ni reinterpreta datos
-- operativos existentes de Recepción.

ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'ACEPTADA';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'REALIZADA';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'DEVUELTA';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'VALIDADA';

ALTER TYPE "ChecklistItemResult" ADD VALUE IF NOT EXISTS 'CUMPLE';
ALTER TYPE "ChecklistItemResult" ADD VALUE IF NOT EXISTS 'OBSERVACION';
ALTER TYPE "ChecklistItemResult" ADD VALUE IF NOT EXISTS 'INCUMPLIMIENTO';

CREATE TYPE "SupervisionVisibility" AS ENUM ('PRIVADO', 'SUPERVISION', 'OPERATIVO');
CREATE TYPE "SupervisionShiftStatus" AS ENUM ('ACTIVO', 'ENTREGADO', 'CERRADO');
CREATE TYPE "TaskTargetType" AS ENUM ('PERSONA', 'MULTIPLES', 'TURNO', 'EQUIPO', 'PROPIO');
CREATE TYPE "TaskParticipantRole" AS ENUM ('PRINCIPAL', 'COLABORADOR');
CREATE TYPE "AuditCategory" AS ENUM (
  'CAJA_MOVIMIENTOS', 'GARANTIAS', 'LLAVES', 'RESERVAS', 'HABITACIONES',
  'CALIDAD_REGISTROS', 'ENTREGA_CIERRE_TURNO', 'CUMPLIMIENTO_PROCEDIMIENTOS', 'OTRO'
);
CREATE TYPE "SupervisionAuditStatus" AS ENUM ('PREPARACION', 'EN_CURSO', 'CERRADA');
CREATE TYPE "AuditDisclosure" AS ENUM ('RESERVADO', 'PERSONA', 'SUPERVISION', 'OPERATIVO');
CREATE TYPE "CorrectiveMeasureStatus" AS ENUM ('PENDIENTE', 'EN_CURSO', 'BLOQUEADA', 'REALIZADA', 'VALIDADA', 'CANCELADA');
CREATE TYPE "PerformanceObservationKind" AS ENUM ('OBSERVACION_SUPERVISOR', 'EXPLICACION_TRABAJADOR', 'CORRECCION_POSTERIOR');

CREATE TABLE "SupervisionShift" (
  "id" TEXT NOT NULL,
  "supervisorId" TEXT NOT NULL,
  "status" "SupervisionShiftStatus" NOT NULL DEFAULT 'ACTIVO',
  "priorities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupervisionShift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupervisionShift_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupervisionShiftHandover" (
  "id" TEXT NOT NULL,
  "supervisionShiftId" TEXT NOT NULL,
  "issuedById" TEXT NOT NULL,
  "receivedById" TEXT,
  "note" TEXT,
  "snapshot" JSONB NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedAt" TIMESTAMP(3),
  CONSTRAINT "SupervisionShiftHandover_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupervisionShiftHandover_supervisionShiftId_fkey" FOREIGN KEY ("supervisionShiftId") REFERENCES "SupervisionShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupervisionShiftHandover_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupervisionShiftHandover_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SupervisionNote" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "visibility" "SupervisionVisibility" NOT NULL DEFAULT 'PRIVADO',
  "authorId" TEXT NOT NULL,
  "supervisionShiftId" TEXT,
  "sourceEntity" TEXT,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedById" TEXT,
  "deletionReason" TEXT,
  CONSTRAINT "SupervisionNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupervisionNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupervisionNote_supervisionShiftId_fkey" FOREIGN KEY ("supervisionShiftId") REFERENCES "SupervisionShift"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "Task"
  ADD COLUMN "fulfillmentCriteria" TEXT,
  ADD COLUMN "evidenceRequired" TEXT,
  ADD COLUMN "evidenceProvided" TEXT,
  ADD COLUMN "targetType" "TaskTargetType" NOT NULL DEFAULT 'PERSONA',
  ADD COLUMN "returnReason" TEXT,
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "reassignmentReason" TEXT,
  ADD COLUMN "targetShiftId" TEXT,
  ADD COLUMN "supervisionShiftId" TEXT,
  ADD COLUMN "roomId" TEXT,
  ADD COLUMN "guestId" TEXT,
  ADD COLUMN "reservationId" TEXT,
  ADD COLUMN "stayId" TEXT,
  ADD COLUMN "validatedAt" TIMESTAMP(3),
  ADD COLUMN "validatedById" TEXT;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_targetShiftId_fkey" FOREIGN KEY ("targetShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_supervisionShiftId_fkey" FOREIGN KEY ("supervisionShiftId") REFERENCES "SupervisionShift"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestReference"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ReservationReference"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "RoomStay"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TaskAssignment" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "TaskParticipantRole" NOT NULL DEFAULT 'COLABORADOR',
  "assignedById" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "removalReason" TEXT,
  CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TaskAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Conserva la asignación principal histórica como participante explícito.
INSERT INTO "TaskAssignment" ("id", "taskId", "userId", "role", "assignedById", "assignedAt")
SELECT gen_random_uuid()::text, t."id", t."assigneeId", 'PRINCIPAL', t."createdById", t."createdAt"
FROM "Task" t
WHERE t."assigneeId" IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "FollowUp"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "priority" "Priority" NOT NULL DEFAULT 'MEDIA',
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "visibility" "SupervisionVisibility" NOT NULL DEFAULT 'OPERATIVO',
  ADD COLUMN "resolution" TEXT,
  ADD COLUMN "supervisionShiftId" TEXT;
ALTER TABLE "FollowUp"
  ADD CONSTRAINT "FollowUp_supervisionShiftId_fkey" FOREIGN KEY ("supervisionShiftId") REFERENCES "SupervisionShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChecklistTemplate"
  ADD COLUMN "category" "AuditCategory" NOT NULL DEFAULT 'OTRO';

ALTER TABLE "ChecklistRun"
  ADD COLUMN "status" "SupervisionAuditStatus" NOT NULL DEFAULT 'EN_CURSO',
  ADD COLUMN "surprise" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scope" TEXT,
  ADD COLUMN "sample" TEXT,
  ADD COLUMN "disclosure" "AuditDisclosure" NOT NULL DEFAULT 'RESERVADO',
  ADD COLUMN "resultSummary" TEXT,
  ADD COLUMN "severity" "Severity",
  ADD COLUMN "reviewedShiftIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "reviewedDepartmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "supervisionShiftId" TEXT,
  ADD COLUMN "closedById" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "deletionReason" TEXT;

UPDATE "ChecklistRun" SET "status" = 'CERRADA' WHERE "finishedAt" IS NOT NULL;

ALTER TABLE "ChecklistRun"
  ADD CONSTRAINT "ChecklistRun_supervisionShiftId_fkey" FOREIGN KEY ("supervisionShiftId") REFERENCES "SupervisionShift"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ChecklistRun_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChecklistRunItem" ADD COLUMN "evidence" TEXT;

CREATE TABLE "AuditParticipant" (
  "id" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "addedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditParticipant_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "ChecklistRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AuditParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AuditParticipant_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AuditFinding" (
  "id" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "itemId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "severity" "Severity" NOT NULL DEFAULT 'MEDIA',
  "confirmed" BOOLEAN NOT NULL DEFAULT false,
  "disclosure" "AuditDisclosure" NOT NULL DEFAULT 'RESERVADO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedById" TEXT,
  "deletionReason" TEXT,
  CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "ChecklistRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AuditFinding_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistRunItem"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CorrectiveMeasure" (
  "id" TEXT NOT NULL,
  "findingId" TEXT,
  "taskId" TEXT,
  "followUpId" TEXT,
  "title" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" "CorrectiveMeasureStatus" NOT NULL DEFAULT 'PENDIENTE',
  "assigneeId" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3),
  "evidence" TEXT,
  "blockedReason" TEXT,
  "createdById" TEXT NOT NULL,
  "validatedAt" TIMESTAMP(3),
  "validatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedById" TEXT,
  "deletionReason" TEXT,
  CONSTRAINT "CorrectiveMeasure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorrectiveMeasure_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CorrectiveMeasure_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CorrectiveMeasure_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CorrectiveMeasure_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectiveMeasure_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CorrectiveMeasure_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PerformanceObservation" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "kind" "PerformanceObservationKind" NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "content" TEXT NOT NULL,
  "sourceEntity" TEXT,
  "sourceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedById" TEXT,
  "deletionReason" TEXT,
  CONSTRAINT "PerformanceObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PerformanceObservation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PerformanceObservation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SupervisionShiftHandover_supervisionShiftId_key" ON "SupervisionShiftHandover"("supervisionShiftId");
CREATE UNIQUE INDEX "supervision_shift_one_open_per_supervisor" ON "SupervisionShift"("supervisorId") WHERE "status" IN ('ACTIVO', 'ENTREGADO');
CREATE INDEX "SupervisionShift_supervisorId_status_idx" ON "SupervisionShift"("supervisorId", "status");
CREATE INDEX "SupervisionShift_startedAt_idx" ON "SupervisionShift"("startedAt");
CREATE INDEX "SupervisionShiftHandover_issuedAt_idx" ON "SupervisionShiftHandover"("issuedAt");
CREATE INDEX "SupervisionShiftHandover_receivedAt_idx" ON "SupervisionShiftHandover"("receivedAt");
CREATE INDEX "SupervisionNote_authorId_visibility_deletedAt_idx" ON "SupervisionNote"("authorId", "visibility", "deletedAt");
CREATE INDEX "SupervisionNote_supervisionShiftId_idx" ON "SupervisionNote"("supervisionShiftId");
CREATE INDEX "SupervisionNote_createdAt_idx" ON "SupervisionNote"("createdAt");
CREATE UNIQUE INDEX "TaskAssignment_taskId_userId_key" ON "TaskAssignment"("taskId", "userId");
CREATE INDEX "TaskAssignment_userId_removedAt_idx" ON "TaskAssignment"("userId", "removedAt");
CREATE INDEX "Task_supervisionShiftId_idx" ON "Task"("supervisionShiftId");
CREATE INDEX "Task_targetShiftId_idx" ON "Task"("targetShiftId");
CREATE INDEX "Task_roomId_idx" ON "Task"("roomId");
CREATE INDEX "Task_reservationId_idx" ON "Task"("reservationId");
CREATE INDEX "FollowUp_supervisionShiftId_idx" ON "FollowUp"("supervisionShiftId");
CREATE INDEX "FollowUp_visibility_idx" ON "FollowUp"("visibility");
CREATE INDEX "ChecklistRun_status_deletedAt_idx" ON "ChecklistRun"("status", "deletedAt");
CREATE INDEX "ChecklistRun_supervisionShiftId_idx" ON "ChecklistRun"("supervisionShiftId");
CREATE UNIQUE INDEX "AuditParticipant_auditId_userId_key" ON "AuditParticipant"("auditId", "userId");
CREATE INDEX "AuditParticipant_userId_idx" ON "AuditParticipant"("userId");
CREATE UNIQUE INDEX "AuditFinding_itemId_key" ON "AuditFinding"("itemId");
CREATE INDEX "AuditFinding_auditId_deletedAt_idx" ON "AuditFinding"("auditId", "deletedAt");
CREATE INDEX "AuditFinding_severity_idx" ON "AuditFinding"("severity");
CREATE UNIQUE INDEX "CorrectiveMeasure_taskId_key" ON "CorrectiveMeasure"("taskId");
CREATE INDEX "CorrectiveMeasure_status_dueAt_idx" ON "CorrectiveMeasure"("status", "dueAt");
CREATE INDEX "CorrectiveMeasure_assigneeId_idx" ON "CorrectiveMeasure"("assigneeId");
CREATE INDEX "CorrectiveMeasure_findingId_idx" ON "CorrectiveMeasure"("findingId");
CREATE INDEX "PerformanceObservation_subjectId_periodStart_periodEnd_idx" ON "PerformanceObservation"("subjectId", "periodStart", "periodEnd");
CREATE INDEX "PerformanceObservation_authorId_idx" ON "PerformanceObservation"("authorId");
CREATE INDEX "PerformanceObservation_deletedAt_idx" ON "PerformanceObservation"("deletedAt");

-- La recepción del relevo actualiza la misma fila, pero la fotografía enviada
-- no puede reescribirse ni siquiera mediante una consulta administrativa.
CREATE FUNCTION prevent_supervision_handover_snapshot_change()
RETURNS trigger AS $$
BEGIN
  IF NEW."snapshot" IS DISTINCT FROM OLD."snapshot" THEN
    RAISE EXCEPTION 'El snapshot de una entrega de Supervisión es inalterable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupervisionShiftHandover_snapshot_immutable"
BEFORE UPDATE ON "SupervisionShiftHandover"
FOR EACH ROW EXECUTE FUNCTION prevent_supervision_handover_snapshot_change();

-- Permisos específicos. El Administrador conserva acceso técnico, pero los
-- servicios rechazan su participación operativa y los selectores lo excluyen.
INSERT INTO "Permission" ("id", "key", "name", "group")
SELECT gen_random_uuid()::text, p."key", p."name", 'Centro de Supervisión'
FROM (VALUES
  ('supervision.center.view', 'Ver el Centro de Supervisión'),
  ('supervision.shift.manage', 'Iniciar, entregar y finalizar turno de Supervisión'),
  ('supervision.task.assign', 'Asignar tareas desde Supervisión'),
  ('supervision.task.validate', 'Validar y devolver tareas realizadas'),
  ('supervision.followup.manage', 'Administrar seguimientos de Supervisión'),
  ('supervision.note.private', 'Crear y consultar notas privadas propias'),
  ('supervision.note.share', 'Compartir notas con Supervisión u Operación'),
  ('supervision.audit.create', 'Crear auditorías sorpresa'),
  ('supervision.audit.close', 'Cerrar auditorías sorpresa'),
  ('supervision.audit.reserved', 'Ver auditorías reservadas'),
  ('supervision.corrective.manage', 'Crear y validar medidas correctivas'),
  ('supervision.performance.view', 'Ver indicadores del equipo'),
  ('supervision.performance.comment', 'Añadir observaciones de rendimiento'),
  ('supervision.history.view', 'Consultar el historial completo de Supervisión')
) AS p("key", "name")
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "group" = EXCLUDED."group";

INSERT INTO "RolePermission" ("roleId", "permissionId", "requiresApproval")
SELECT r."id", p."id", false
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA')
  AND p."group" = 'Centro de Supervisión'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
