-- AlterTable
ALTER TABLE "HousekeepingRequest" ADD COLUMN     "effortMinutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "inspectedAt" TIMESTAMP(3),
ADD COLUMN     "inspectedById" TEXT,
ADD COLUMN     "maintenanceEntryId" TEXT,
ADD COLUMN     "requiresInspection" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "roomId" TEXT,
ADD COLUMN     "routineId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "workDate" TEXT,
ADD COLUMN     "workKind" TEXT NOT NULL DEFAULT 'AVISO',
ADD COLUMN     "workflowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "zoneId" TEXT;

-- CreateTable
CREATE TABLE "HousekeepingRoutine" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "effortMinutes" INTEGER NOT NULL DEFAULT 20,
    "requiresInspection" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HousekeepingRoutine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingDayMember" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "confirmedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousekeepingDayMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingHandover" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "HousekeepingHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingDelegation" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "permission" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HousekeepingDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HousekeepingRoutine_departmentId_active_idx" ON "HousekeepingRoutine"("departmentId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "HousekeepingDayMember_departmentId_workDate_userId_key" ON "HousekeepingDayMember"("departmentId", "workDate", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "HousekeepingHandover_requestKey_key" ON "HousekeepingHandover"("requestKey");

-- CreateIndex
CREATE INDEX "HousekeepingHandover_departmentId_createdAt_idx" ON "HousekeepingHandover"("departmentId", "createdAt");

-- CreateIndex
CREATE INDEX "HousekeepingDelegation_userId_departmentId_endsAt_idx" ON "HousekeepingDelegation"("userId", "departmentId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "HousekeepingRequest_maintenanceEntryId_key" ON "HousekeepingRequest"("maintenanceEntryId");

-- CreateIndex
CREATE INDEX "HousekeepingRequest_departmentId_workDate_status_idx" ON "HousekeepingRequest"("departmentId", "workDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HousekeepingRequest_routineId_workDate_key" ON "HousekeepingRequest"("routineId", "workDate");

-- AddForeignKey
ALTER TABLE "HousekeepingRequest" ADD CONSTRAINT "HousekeepingRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingRequest" ADD CONSTRAINT "HousekeepingRequest_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "KeyArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingRequest" ADD CONSTRAINT "HousekeepingRequest_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingRequest" ADD CONSTRAINT "HousekeepingRequest_maintenanceEntryId_fkey" FOREIGN KEY ("maintenanceEntryId") REFERENCES "OperationalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingRequest" ADD CONSTRAINT "HousekeepingRequest_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "HousekeepingRoutine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingRoutine" ADD CONSTRAINT "HousekeepingRoutine_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingDayMember" ADD CONSTRAINT "HousekeepingDayMember_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingDayMember" ADD CONSTRAINT "HousekeepingDayMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingHandover" ADD CONSTRAINT "HousekeepingHandover_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingHandover" ADD CONSTRAINT "HousekeepingHandover_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingHandover" ADD CONSTRAINT "HousekeepingHandover_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingDelegation" ADD CONSTRAINT "HousekeepingDelegation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingDelegation" ADD CONSTRAINT "HousekeepingDelegation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingDelegation" ADD CONSTRAINT "HousekeepingDelegation_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Extend the existing workflow without rewriting historical notices.
ALTER TABLE "HousekeepingRequest" DROP CONSTRAINT "HousekeepingRequest_status_check";
ALTER TABLE "HousekeepingRequest" ADD CONSTRAINT "HousekeepingRequest_status_check" CHECK ("status" IN ('PENDIENTE','RECIBIDO','EN_GESTION','BLOQUEADO','POR_REVISAR','RESUELTO','CANCELADO'));
ALTER TABLE "HousekeepingRequest" ADD CONSTRAINT "HousekeepingRequest_work_check" CHECK ("workflowVersion" IN (0,1) AND "effortMinutes" BETWEEN 1 AND 480 AND NOT ("roomId" IS NOT NULL AND "zoneId" IS NOT NULL) AND ("workflowVersion" = 0 OR ("workDate" IS NOT NULL AND "workDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "departmentId" IS NOT NULL AND "workKind" IN ('LIMPIEZA','ZONA_COMUN','REPOSICION','REVISION','ATENCION') AND ("workKind" <> 'LIMPIEZA' OR ("roomId" IS NOT NULL AND "requiresInspection" = true)) AND ("workKind" <> 'REVISION' OR "requiresInspection" = true))));
ALTER TABLE "HousekeepingRoutine" ADD CONSTRAINT "HousekeepingRoutine_effort_check" CHECK ("effortMinutes" BETWEEN 1 AND 480);
ALTER TABLE "HousekeepingDelegation" ADD CONSTRAINT "HousekeepingDelegation_window_check" CHECK ("startsAt" < "endsAt" AND "endsAt" - "startsAt" <= interval '31 days' AND "permission" IN ('housekeeping.assign','housekeeping.inspect'));

-- Granular permissions and new area roles. Existing user roles are unchanged.
INSERT INTO "Permission" ("id","key","name","group") VALUES ('perm_housekeeping_request','housekeeping.request','Solicitar una atención a Housekeeping y consultar su resultado','Housekeeping') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id","key","name","group") VALUES ('perm_housekeeping_work','housekeeping.work','Ejecutar mis trabajos asignados','Housekeeping') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id","key","name","group") VALUES ('perm_housekeeping_assign','housekeeping.assign','Organizar y asignar trabajo de mis áreas','Housekeeping') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id","key","name","group") VALUES ('perm_housekeeping_inspect','housekeeping.inspect','Inspeccionar trabajos de otras personas en mis áreas','Housekeeping') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id","key","name","group") VALUES ('perm_housekeeping_plan','housekeeping.plan','Planificar rutinas y delegar cobertura de mis áreas','Housekeeping') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id","key","name","group") VALUES ('perm_housekeeping_view_all','housekeeping.view.all','Consultar el trabajo de todas las áreas, sin modificarlo','Housekeeping') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id","key","name","group") VALUES ('perm_housekeeping_view','housekeeping.view','Consultar avisos de Housekeeping','Housekeeping') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id","key","name","group") VALUES ('perm_housekeeping_manage','housekeeping.manage','Crear y gestionar avisos de Housekeeping','Housekeeping') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Role" ("id","key","name","description","level","operational","isSystem","createdAt","updatedAt") VALUES ('role_mucama','MUCAMA','Mucama','Operación de Housekeeping limitada a sus áreas.',30,true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r."id",p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE r."key"='MUCAMA' AND p."key" IN ('housekeeping.work','housekeeping.request','schedule.self.view') ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("id","key","name","description","level","operational","isSystem","createdAt","updatedAt") VALUES ('role_supervisor_housekeeping','SUPERVISOR_HOUSEKEEPING','Supervisor/a de Housekeeping','Operación de Housekeeping limitada a sus áreas.',60,true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r."id",p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE r."key"='SUPERVISOR_HOUSEKEEPING' AND p."key" IN ('housekeeping.view','housekeeping.work','housekeeping.request','housekeeping.assign','housekeeping.inspect','schedule.self.view') ON CONFLICT DO NOTHING;
INSERT INTO "Role" ("id","key","name","description","level","operational","isSystem","createdAt","updatedAt") VALUES ('role_ama_de_llaves','AMA_DE_LLAVES','Ama de llaves','Operación de Housekeeping limitada a sus áreas.',65,true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r."id",p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE r."key"='AMA_DE_LLAVES' AND p."key" IN ('housekeeping.view','housekeeping.work','housekeeping.request','housekeeping.assign','housekeeping.inspect','housekeeping.plan','schedule.self.view','schedule.view','schedule.manage','schedule.publish','schedule.catalog.manage','schedule.extra.approve') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r."id",p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE (r."key"='ADMINISTRADOR_SISTEMA' AND p."key" LIKE 'housekeeping.%') OR (r."key" IN ('RECEPCIONISTA','AUDITOR_NOCTURNO','SUPERVISOR') AND p."key"='housekeeping.request') OR (r."key"='GERENCIA' AND p."key"='housekeeping.view.all') ON CONFLICT DO NOTHING;

-- A new cleaning cannot be closed without a recorded inspection by another person.
ALTER TABLE "HousekeepingRequest" ADD CONSTRAINT "HousekeepingRequest_inspection_evidence_check" CHECK (
  "workflowVersion" = 0 OR (
    ("status" <> 'POR_REVISAR' OR "finishedAt" IS NOT NULL) AND
    ("status" <> 'RESUELTO' OR NOT "requiresInspection" OR (
      "finishedAt" IS NOT NULL AND "inspectedAt" IS NOT NULL AND "inspectedById" IS NOT NULL AND
      "assignedToId" IS NOT NULL AND "inspectedById" <> "assignedToId"
    ))
  )
);
