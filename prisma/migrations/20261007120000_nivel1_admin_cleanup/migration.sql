-- Additive only: existing records and role grants remain unchanged.
ALTER TABLE "Notification" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT, ADD COLUMN "deletionReason" TEXT;
ALTER TABLE "CashAudit" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT, ADD COLUMN "deletionReason" TEXT;
ALTER TABLE "HousekeepingRequest" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT, ADD COLUMN "deletionReason" TEXT;
ALTER TABLE "ai_message" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT, ADD COLUMN "deletionReason" TEXT;
ALTER TABLE "ai_memory" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT, ADD COLUMN "deletionReason" TEXT;

INSERT INTO "Permission" ("id", "key", "name", "group") VALUES
 ('perm_entry_content_edit', 'entry.content.edit', 'Editar el contenido de registros', 'Libro operativo')
ON CONFLICT ("key") DO NOTHING;
-- Separate content editing from operational attention. Preserve configured grants outside the desk.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE p."key" = 'entry.content.edit'
 AND r."key" NOT IN ('RECEPCIONISTA', 'AUDITOR_NOCTURNO')
 AND EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" old ON old."id"=rp."permissionId"
             WHERE rp."roleId"=r."id" AND old."key"='entry.edit')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
