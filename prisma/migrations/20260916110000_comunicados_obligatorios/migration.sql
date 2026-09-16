-- Comunicados obligatorios que bloquean la interfaz.
--
-- Un comunicado bloquea la pantalla de quien no lo ha confirmado. No es una
-- notificación —ésas se pueden ignorar— ni una alerta —ésas describen un
-- estado del hotel—: es el Supervisor diciendo «nadie sigue trabajando sin
-- haber leído esto».
--
-- La confirmación guarda TEXTO a propósito: un botón solo se pulsa sin leer.
-- Lo escrito queda en `AnnouncementRead.confirmationText`, así que después se
-- sabe no sólo quién confirmó, sino qué entendió.
--
-- COMPATIBILIDAD: puramente ADITIVA. Dos tablas y un enum nuevos; ninguna
-- columna existente se toca. Sin comunicados emitidos, nada bloquea a nadie,
-- así que el comportamiento anterior se conserva exactamente.
--
-- LO QUE NO SE ALMACENA: la lista de pendientes de cada persona. Se calcula al
-- leer como «activos menos los que confirmó», igual que los conflictos de
-- importación: una lista guardada se desincroniza en cuanto alguien confirma.
--
-- REVERSIBLE: eliminar las dos tablas y el enum.

-- CreateEnum
CREATE TYPE "AnnouncementScope" AS ENUM ('TODOS', 'USUARIO');

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scope" "AnnouncementScope" NOT NULL DEFAULT 'TODOS',
    "targetUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletionReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confirmationText" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_active_deletedAt_idx" ON "Announcement"("active", "deletedAt");

-- CreateIndex
CREATE INDEX "Announcement_targetUserId_idx" ON "Announcement"("targetUserId");

-- CreateIndex
CREATE INDEX "AnnouncementRead_userId_idx" ON "AnnouncementRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_userId_key" ON "AnnouncementRead"("announcementId", "userId");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- El permiso de emitir comunicados. El catálogo se siembra al instalar, así
-- que una base ya instalada lo necesita acá. Se une por clave y no toca otras
-- filas, para conservar los permisos ajustados desde /admin/roles.
INSERT INTO "Permission" ("id", "key", "name", "group")
VALUES (
  gen_random_uuid()::text,
  'announcement.manage',
  'Emitir comunicados obligatorios',
  'Supervisión'
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r
CROSS JOIN "Permission" AS p
WHERE r."key" IN ('ADMINISTRADOR_SISTEMA', 'SUPERVISOR')
  AND p."key" = 'announcement.manage'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
