-- Bandeja persistente de Reportar / solicitar.
-- El correo queda como canal secundario; la fuente de verdad pasa a ser Neon.

CREATE TYPE "SupportRequestKind" AS ENUM ('ERROR', 'FUNCION');
CREATE TYPE "SupportRequestStatus" AS ENUM ('NUEVA', 'EN_REVISION', 'RESUELTA', 'DESCARTADA');

CREATE TABLE "SupportRequest" (
  "id" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "kind" "SupportRequestKind" NOT NULL,
  "status" "SupportRequestStatus" NOT NULL DEFAULT 'NUEVA',
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requesterName" TEXT NOT NULL,
  "requesterUser" TEXT NOT NULL,
  "requesterRole" TEXT NOT NULL,
  "requesterEmail" TEXT,
  "context" JSONB NOT NULL,
  "attachmentNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "emailRecipient" TEXT,
  "emailSent" BOOLEAN NOT NULL DEFAULT false,
  "emailError" TEXT,
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportRequest_correlationId_key" ON "SupportRequest"("correlationId");
CREATE INDEX "SupportRequest_status_createdAt_idx" ON "SupportRequest"("status", "createdAt");
CREATE INDEX "SupportRequest_kind_createdAt_idx" ON "SupportRequest"("kind", "createdAt");
CREATE INDEX "SupportRequest_requestedById_createdAt_idx" ON "SupportRequest"("requestedById", "createdAt");

ALTER TABLE "SupportRequest"
  ADD CONSTRAINT "SupportRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRequest"
  ADD CONSTRAINT "SupportRequest_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key", "name", "description", "group")
VALUES
  (
    gen_random_uuid()::text,
    'support.view',
    'Ver bandeja de reportes y solicitudes',
    'Permite consultar los reportes de problema y solicitudes de función enviados desde AROH.',
    'Administración'
  ),
  (
    gen_random_uuid()::text,
    'support.manage',
    'Gestionar reportes y solicitudes',
    'Permite cambiar estado y registrar resolución en la bandeja de soporte.',
    'Administración'
  )
ON CONFLICT ("key") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "group" = EXCLUDED."group";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN ('support.view', 'support.manage')
WHERE r."key" = 'ADMINISTRADOR_SISTEMA'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
