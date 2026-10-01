-- CreateTable
CREATE TABLE "ScheduleCollaborator" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "functionName" TEXT NOT NULL,
    "userId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "weeklyMinutes" INTEGER,
    "minRestMinutes" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleMembership" (
    "collaboratorId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ScheduleMembership_pkey" PRIMARY KEY ("collaboratorId","departmentId")
);

-- CreateTable
CREATE TABLE "ScheduleAreaGrant" (
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "ScheduleAreaGrant_pkey" PRIMARY KEY ("userId","departmentId")
);

-- CreateTable
CREATE TABLE "ScheduleTemplate" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "crossesMidnight" BOOLEAN NOT NULL DEFAULT false,
    "breakStartTime" TEXT,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakPaid" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulePlan" (
    "id" TEXT NOT NULL,
    "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass),
    "departmentId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BORRADOR',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedVersion" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSlot" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TURNO',
    "templateId" TEXT,
    "code" TEXT NOT NULL,
    "functionName" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "crossesMidnight" BOOLEAN NOT NULL DEFAULT false,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "baseEndAt" TIMESTAMP(3),
    "breakStartAt" TIMESTAMP(3),
    "breakEndAt" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakPaid" BOOLEAN NOT NULL DEFAULT false,
    "extraKind" TEXT NOT NULL DEFAULT 'NINGUNO',
    "extraMinutes" INTEGER NOT NULL DEFAULT 0,
    "extraStatus" TEXT NOT NULL DEFAULT 'NO_APLICA',
    "reportedExtraMinutes" INTEGER,
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleEvent" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleAcknowledgment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleImport" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "rows" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REVISION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduleImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleCoverageRule" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "functionName" TEXT,
    "weekdays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "crossesMidnight" BOOLEAN NOT NULL DEFAULT false,
    "minimum" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ScheduleCoverageRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleHoliday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ScheduleHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleCollaborator_employeeCode_key" ON "ScheduleCollaborator"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleCollaborator_userId_key" ON "ScheduleCollaborator"("userId");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_departmentId_active_idx" ON "ScheduleTemplate"("departmentId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTemplate_departmentId_code_revision_key" ON "ScheduleTemplate"("departmentId", "code", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulePlan_humanId_key" ON "SchedulePlan"("humanId");

-- CreateIndex
CREATE INDEX "SchedulePlan_departmentId_status_idx" ON "SchedulePlan"("departmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulePlan_departmentId_startDate_endDate_key" ON "SchedulePlan"("departmentId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ScheduleSlot_planId_date_idx" ON "ScheduleSlot"("planId", "date");

-- CreateIndex
CREATE INDEX "ScheduleSlot_collaboratorId_startAt_endAt_idx" ON "ScheduleSlot"("collaboratorId", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleEvent_requestKey_key" ON "ScheduleEvent"("requestKey");

-- CreateIndex
CREATE INDEX "ScheduleEvent_planId_createdAt_idx" ON "ScheduleEvent"("planId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleAcknowledgment_planId_userId_version_key" ON "ScheduleAcknowledgment"("planId", "userId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleImport_planId_fileHash_baseVersion_key" ON "ScheduleImport"("planId", "fileHash", "baseVersion");

-- CreateIndex
CREATE INDEX "ScheduleCoverageRule_departmentId_active_idx" ON "ScheduleCoverageRule"("departmentId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleHoliday_date_key" ON "ScheduleHoliday"("date");

-- CreateIndex
CREATE INDEX "ScheduleHoliday_date_active_idx" ON "ScheduleHoliday"("date", "active");

-- AddForeignKey
ALTER TABLE "ScheduleCollaborator" ADD CONSTRAINT "ScheduleCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleMembership" ADD CONSTRAINT "ScheduleMembership_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "ScheduleCollaborator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleMembership" ADD CONSTRAINT "ScheduleMembership_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAreaGrant" ADD CONSTRAINT "ScheduleAreaGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAreaGrant" ADD CONSTRAINT "ScheduleAreaGrant_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulePlan" ADD CONSTRAINT "SchedulePlan_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SchedulePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "ScheduleCollaborator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScheduleTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SchedulePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAcknowledgment" ADD CONSTRAINT "ScheduleAcknowledgment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SchedulePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleAcknowledgment" ADD CONSTRAINT "ScheduleAcknowledgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleImport" ADD CONSTRAINT "ScheduleImport_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SchedulePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleCoverageRule" ADD CONSTRAINT "ScheduleCoverageRule_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariants shared by manual planning, imports and drag operations.
CREATE UNIQUE INDEX "ScheduleTemplate_current_code" ON "ScheduleTemplate" ("departmentId", "code") WHERE "active" = true;
CREATE UNIQUE INDEX "ScheduleSlot_work_start" ON "ScheduleSlot" ("collaboratorId", "startAt") WHERE "cancelledAt" IS NULL AND "kind" = 'TURNO';
CREATE UNIQUE INDEX "ScheduleSlot_nonwork_day" ON "ScheduleSlot" ("planId", "collaboratorId", "date") WHERE "cancelledAt" IS NULL AND "kind" <> 'TURNO';
ALTER TABLE "ScheduleCollaborator" ADD CONSTRAINT "ScheduleCollaborator_limits" CHECK ("version" > 0 AND "minRestMinutes" BETWEEN 0 AND 2880 AND ("weeklyMinutes" IS NULL OR "weeklyMinutes" BETWEEN 1 AND 10080));
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_clock" CHECK ("revision" > 0 AND "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "breakMinutes" BETWEEN 0 AND 180 AND ("breakMinutes" = 0 OR "breakStartTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND ((NOT "crossesMidnight" AND "endTime" > "startTime") OR ("crossesMidnight" AND "endTime" <= "startTime")));
ALTER TABLE "SchedulePlan" ADD CONSTRAINT "SchedulePlan_state" CHECK ("endDate" >= "startDate" AND "endDate" - "startDate" <= 62 AND "version" > 0 AND ( ("status" = 'BORRADOR' AND "publishedVersion" IS NULL AND "publishedAt" IS NULL) OR ("status" = 'PUBLICADO' AND "publishedVersion" > 0 AND "publishedVersion" <= "version" AND "publishedAt" IS NOT NULL) ));
ALTER TABLE "ScheduleSlot" ADD CONSTRAINT "ScheduleSlot_state" CHECK ("kind" IN ('TURNO', 'LIBRE', 'VACACIONES', 'AUSENCIA') AND "extraKind" IN ('NINGUNO', 'EXTENSION', 'TURNO_EXTRA') AND "extraStatus" IN ('NO_APLICA', 'PENDIENTE', 'APROBADO', 'RECHAZADO', 'REPORTADO', 'VALIDADO') AND "extraMinutes" BETWEEN 0 AND 720 AND "breakMinutes" BETWEEN 0 AND 180 AND ("reportedExtraMinutes" IS NULL OR "reportedExtraMinutes" BETWEEN 0 AND 2160) AND ( ("extraKind" = 'NINGUNO' AND "extraMinutes" = 0 AND "extraStatus" = 'NO_APLICA') OR ("extraKind" = 'EXTENSION' AND "extraMinutes" > 0 AND "extraStatus" <> 'NO_APLICA') OR ("extraKind" = 'TURNO_EXTRA' AND "extraMinutes" = 0 AND "extraStatus" <> 'NO_APLICA') ) AND ( ("kind" = 'TURNO' AND "templateId" IS NOT NULL AND "startAt" IS NOT NULL AND "endAt" > "startAt" AND "baseEndAt" > "startAt" AND "endAt" >= "baseEndAt") OR ("kind" <> 'TURNO' AND "templateId" IS NULL AND "startAt" IS NULL AND "endAt" IS NULL AND "extraKind" = 'NINGUNO') ));
ALTER TABLE "ScheduleCoverageRule" ADD CONSTRAINT "ScheduleCoverageRule_limits" CHECK ("minimum" BETWEEN 1 AND 100 AND cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[0,1,2,3,4,5,6] AND "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ((NOT "crossesMidnight" AND "endTime" > "startTime") OR ("crossesMidnight" AND "endTime" <= "startTime")));

-- Initial access: administrator only. Other role grants are unchanged.
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_schedule_self_view', 'schedule.self.view', 'Consultar y confirmar mi horario publicado', 'Equipo y horarios') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_schedule_view', 'schedule.view', 'Consultar horarios publicados de mis áreas', 'Equipo y horarios') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_schedule_view_all', 'schedule.view.all', 'Consultar horarios publicados de todas las áreas', 'Equipo y horarios') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_schedule_manage', 'schedule.manage', 'Crear, cargar y modificar mallas de mis áreas', 'Equipo y horarios') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_schedule_publish', 'schedule.publish', 'Publicar horarios y cambios de mis áreas', 'Equipo y horarios') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_schedule_catalog_manage', 'schedule.catalog.manage', 'Gestionar colaboradores, plantillas y cobertura de mis áreas', 'Equipo y horarios') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_schedule_extra_approve', 'schedule.extra.approve', 'Aprobar y validar extras de mis áreas', 'Equipo y horarios') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "Permission" ("id", "key", "name", "group") VALUES ('perm_schedule_configure', 'schedule.configure', 'Administrar alcance por área y feriados', 'Equipo y horarios') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE r."key" = 'ADMINISTRADOR_SISTEMA' AND p."key" LIKE 'schedule.%' ON CONFLICT DO NOTHING;

-- Only the supplied Reception glosa. No people or operational schedules are seeded.
INSERT INTO "ScheduleTemplate" ("id", "departmentId", "code", "label", "startTime", "endTime", "crossesMidnight") SELECT 'schedule_template_recepcion_rd01_1', d."id", 'RD01', 'Glosa de recepción RD01', '08:00', '19:00', false FROM "Department" d WHERE d."key" = 'RECEPCION' ON CONFLICT DO NOTHING;
INSERT INTO "ScheduleTemplate" ("id", "departmentId", "code", "label", "startTime", "endTime", "crossesMidnight") SELECT 'schedule_template_recepcion_rd02_1', d."id", 'RD02', 'Glosa de recepción RD02', '11:00', '22:00', false FROM "Department" d WHERE d."key" = 'RECEPCION' ON CONFLICT DO NOTHING;
INSERT INTO "ScheduleTemplate" ("id", "departmentId", "code", "label", "startTime", "endTime", "crossesMidnight") SELECT 'schedule_template_recepcion_rn01_1', d."id", 'RN01', 'Glosa de recepción RN01', '21:00', '08:00', true FROM "Department" d WHERE d."key" = 'RECEPCION' ON CONFLICT DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_01_01', '2026-01-01', 'Año Nuevo', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_04_03', '2026-04-03', 'Viernes Santo', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_04_04', '2026-04-04', 'Sábado Santo', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_05_01', '2026-05-01', 'Día del Trabajo', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_05_21', '2026-05-21', 'Glorias Navales', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_06_21', '2026-06-21', 'Día Nacional de los Pueblos Indígenas', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_06_29', '2026-06-29', 'San Pedro y San Pablo', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_07_16', '2026-07-16', 'Virgen del Carmen', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_08_15', '2026-08-15', 'Asunción de la Virgen', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_09_18', '2026-09-18', 'Independencia Nacional', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_09_19', '2026-09-19', 'Glorias del Ejército', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_10_12', '2026-10-12', 'Encuentro de Dos Mundos', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_10_31', '2026-10-31', 'Día de las Iglesias Evangélicas y Protestantes', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_11_01', '2026-11-01', 'Día de Todos los Santos', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_12_08', '2026-12-08', 'Inmaculada Concepción', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
INSERT INTO "ScheduleHoliday" ("id", "date", "name", "source") VALUES ('schedule_holiday_2026_12_25', '2026-12-25', 'Navidad', 'https://www.gob.cl/noticias/feriados-2026-revisa-cuantos-habra-y-cuales-son-irrenunciables/') ON CONFLICT ("date") DO NOTHING;
