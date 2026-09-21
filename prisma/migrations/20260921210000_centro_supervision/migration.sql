-- CreateEnum
CREATE TYPE "SupervisionShiftStatus" AS ENUM ('ACTIVO', 'ENTREGADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "SupervisionVisibility" AS ENUM ('PRIVADO', 'SUPERVISION', 'OPERATIVO');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PENDIENTE', 'CUMPLE', 'OBSERVACION', 'INCUMPLIMIENTO', 'NO_APLICA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskStatus" ADD VALUE 'ACEPTADA';
ALTER TYPE "TaskStatus" ADD VALUE 'REALIZADA';
ALTER TYPE "TaskStatus" ADD VALUE 'DEVUELTA';
ALTER TYPE "TaskStatus" ADD VALUE 'VALIDADA';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "acceptanceCriteria" TEXT,
ADD COLUMN     "evidence" TEXT,
ADD COLUMN     "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validatedById" TEXT;

-- CreateTable
CREATE TABLE "SupervisionShift" (
    "id" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "status" "SupervisionShiftStatus" NOT NULL DEFAULT 'ACTIVO',
    "priorities" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handedOverAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SupervisionShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisionHandover" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisionHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCollaborator" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskCollaborator_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "SupervisionNote" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "SupervisionVisibility" NOT NULL DEFAULT 'PRIVADO',
    "nextReviewAt" TIMESTAMP(3),
    "priority" "Priority" NOT NULL DEFAULT 'MEDIA',
    "resolution" TEXT,
    "source" TEXT,
    "publishedTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletionReason" TEXT,

    CONSTRAINT "SupervisionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisionNoteRevision" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisionNoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "points" TEXT[],
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletionReason" TEXT,

    CONSTRAINT "InspectionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "sample" TEXT NOT NULL,
    "reviewedPeople" TEXT[],
    "reviewedShifts" TEXT[],
    "area" TEXT NOT NULL,
    "visibility" "SupervisionVisibility" NOT NULL DEFAULT 'PRIVADO',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "result" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletionReason" TEXT,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionPoint" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "result" "InspectionResult" NOT NULL DEFAULT 'PENDIENTE',
    "evidence" TEXT,
    "observation" TEXT,
    "severity" "Severity" NOT NULL DEFAULT 'BAJA',

    CONSTRAINT "InspectionPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectiveMeasure" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletionReason" TEXT,

    CONSTRAINT "CorrectiveMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceObservation" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "workerExplanation" TEXT,
    "context" TEXT NOT NULL,
    "sources" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletionReason" TEXT,

    CONSTRAINT "PerformanceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupervisionShift_supervisorId_status_idx" ON "SupervisionShift"("supervisorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisionHandover_shiftId_key" ON "SupervisionHandover"("shiftId");

-- CreateIndex
CREATE INDEX "TaskCollaborator_userId_idx" ON "TaskCollaborator"("userId");

-- CreateIndex
CREATE INDEX "SupervisionNote_authorId_visibility_deletedAt_idx" ON "SupervisionNote"("authorId", "visibility", "deletedAt");

-- CreateIndex
CREATE INDEX "SupervisionNote_nextReviewAt_idx" ON "SupervisionNote"("nextReviewAt");

-- CreateIndex
CREATE INDEX "SupervisionNoteRevision_noteId_createdAt_idx" ON "SupervisionNoteRevision"("noteId", "createdAt");

-- CreateIndex
CREATE INDEX "Inspection_auditorId_closedAt_deletedAt_idx" ON "Inspection"("auditorId", "closedAt", "deletedAt");

-- CreateIndex
CREATE INDEX "InspectionPoint_inspectionId_idx" ON "InspectionPoint"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectiveMeasure_taskId_key" ON "CorrectiveMeasure"("taskId");

-- CreateIndex
CREATE INDEX "CorrectiveMeasure_pointId_idx" ON "CorrectiveMeasure"("pointId");

-- CreateIndex
CREATE INDEX "PerformanceObservation_subjectId_periodStart_periodEnd_idx" ON "PerformanceObservation"("subjectId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "SupervisionShift" ADD CONSTRAINT "SupervisionShift_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisionHandover" ADD CONSTRAINT "SupervisionHandover_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "SupervisionShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisionHandover" ADD CONSTRAINT "SupervisionHandover_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCollaborator" ADD CONSTRAINT "TaskCollaborator_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCollaborator" ADD CONSTRAINT "TaskCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisionNote" ADD CONSTRAINT "SupervisionNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisionNoteRevision" ADD CONSTRAINT "SupervisionNoteRevision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "SupervisionNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionTemplate" ADD CONSTRAINT "InspectionTemplate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionPoint" ADD CONSTRAINT "InspectionPoint_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectiveMeasure" ADD CONSTRAINT "CorrectiveMeasure_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "InspectionPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectiveMeasure" ADD CONSTRAINT "CorrectiveMeasure_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectiveMeasure" ADD CONSTRAINT "CorrectiveMeasure_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceObservation" ADD CONSTRAINT "PerformanceObservation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceObservation" ADD CONSTRAINT "PerformanceObservation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariantes independientes de los turnos de Recepción.
CREATE UNIQUE INDEX "SupervisionShift_one_open_per_user" ON "SupervisionShift" ("supervisorId") WHERE "status" IN ('ACTIVO', 'ENTREGADO');
ALTER TABLE "SupervisionShift" ADD CONSTRAINT "SupervisionShift_state_dates" CHECK (
 ("status" = 'ACTIVO' AND "handedOverAt" IS NULL AND "finishedAt" IS NULL) OR
 ("status" = 'ENTREGADO' AND "handedOverAt" IS NOT NULL AND "finishedAt" IS NULL) OR
 ("status" = 'FINALIZADO' AND "handedOverAt" IS NOT NULL AND "finishedAt" IS NOT NULL)
);
CREATE FUNCTION preserve_supervision_handover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'La entrega de Supervisión enviada es inalterable'; END;
$$;
CREATE TRIGGER "SupervisionHandover_immutable" BEFORE UPDATE ON "SupervisionHandover" FOR EACH ROW EXECUTE FUNCTION preserve_supervision_handover();
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_task.validate', 'task.validate', 'Validar y devolver tareas', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'task.validate' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.notes', 'supervision.notes', 'Administrar notas privadas y seguimientos de Supervisión', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.notes' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.share', 'supervision.share', 'Compartir notas de Supervisión', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.share' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.inspections', 'supervision.inspections', 'Crear y cerrar auditorías sorpresa', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.inspections' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.reserved', 'supervision.reserved', 'Consultar auditorías reservadas', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.reserved' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.corrective', 'supervision.corrective', 'Crear medidas correctivas', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.corrective' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.performance', 'supervision.performance', 'Consultar indicadores del equipo', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.performance' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.observe', 'supervision.observe', 'Añadir observaciones de rendimiento', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.observe' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.history', 'supervision.history', 'Consultar el historial de Supervisión', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.history' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.center', 'supervision.center', 'Ver el Centro de Supervisión', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.center' AND r."key" IN ('SUPERVISOR', 'ADMINISTRADOR_SISTEMA') ON CONFLICT DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_supervision.shift', 'supervision.shift', 'Gestionar el turno propio de Supervisión', 'Supervisión') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE p."key" = 'supervision.shift' AND r."key" IN ('SUPERVISOR') ON CONFLICT DO NOTHING;
