-- Adjuntos persistentes de Reportar / solicitar.
-- El binario vive en R2; Neon conserva sólo metadatos y relación con la solicitud.

CREATE TYPE "SupportRequestAttachmentKind" AS ENUM ('CAPTURA', 'ARCHIVO');

CREATE TABLE "SupportRequestAttachment" (
  "id" TEXT NOT NULL,
  "supportRequestId" TEXT NOT NULL,
  "kind" "SupportRequestAttachmentKind" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupportRequestAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportRequestAttachment_storageKey_key"
  ON "SupportRequestAttachment"("storageKey");

CREATE INDEX "SupportRequestAttachment_supportRequestId_createdAt_idx"
  ON "SupportRequestAttachment"("supportRequestId", "createdAt");

ALTER TABLE "SupportRequestAttachment"
  ADD CONSTRAINT "SupportRequestAttachment_supportRequestId_fkey"
  FOREIGN KEY ("supportRequestId") REFERENCES "SupportRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
