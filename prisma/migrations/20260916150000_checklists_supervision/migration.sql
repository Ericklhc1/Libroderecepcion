-- Checklists de supervisión, armables por el Supervisor.
--
-- Dos modelos y no uno: la PLANTILLA es lo que se define una vez, la
-- EJECUCIÓN es lo que se recorrió un día concreto.
--
-- La ejecución COPIA el texto de cada punto (`ChecklistRunItem.text` y
-- `ChecklistRun.templateName`). Si apuntara a la plantilla viva, editar un
-- punto cambiaría lo que alguien ya firmó el mes pasado, y un control que se
-- puede reescribir hacia atrás no controla nada. Eso es lo que permite editar
-- una plantilla sin reescribir la historia.
--
-- Un punto crítico que falla deja la ronda marcada como crítica. Una falla sin
-- observación se rechaza: no sirve de nada saber que algo falló sin saber qué.
--
-- COMPATIBILIDAD: puramente ADITIVA. Cuatro tablas y una enumeración nuevas;
-- ninguna columna existente se toca. Sin plantillas definidas, nada cambia.
--
-- REVERSIBLE: eliminar las cuatro tablas y la enumeración.

-- CreateEnum
CREATE TYPE "ChecklistItemResult" AS ENUM ('PENDIENTE', 'OK', 'FALLA', 'NO_APLICA');

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cadence" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletionReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistRun" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "runById" TEXT NOT NULL,
    "shiftId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChecklistRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistRunItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "result" "ChecklistItemResult" NOT NULL DEFAULT 'PENDIENTE',
    "observation" TEXT,
    "entryId" TEXT,

    CONSTRAINT "ChecklistRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistTemplate_active_deletedAt_idx" ON "ChecklistTemplate"("active", "deletedAt");

-- CreateIndex
CREATE INDEX "ChecklistTemplateItem_templateId_idx" ON "ChecklistTemplateItem"("templateId");

-- CreateIndex
CREATE INDEX "ChecklistRun_templateId_idx" ON "ChecklistRun"("templateId");

-- CreateIndex
CREATE INDEX "ChecklistRun_runById_idx" ON "ChecklistRun"("runById");

-- CreateIndex
CREATE INDEX "ChecklistRun_finishedAt_idx" ON "ChecklistRun"("finishedAt");

-- CreateIndex
CREATE INDEX "ChecklistRunItem_runId_idx" ON "ChecklistRunItem"("runId");

-- AddForeignKey
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTemplateItem" ADD CONSTRAINT "ChecklistTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_runById_fkey" FOREIGN KEY ("runById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRunItem" ADD CONSTRAINT "ChecklistRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChecklistRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRunItem" ADD CONSTRAINT "ChecklistRunItem_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "OperationalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

