-- Regulariza el concepto de turno de emergencia y versiona la consolidación
-- de informes de Supervisión sin borrar historia.

ALTER TABLE "Shift"
  ADD COLUMN "emergencyReleasedAt" TIMESTAMP(3),
  ADD COLUMN "emergencyReleaseReason" TEXT;

ALTER TABLE "SupervisionAuditImport"
  ADD COLUMN "reportPayloads" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Una emergencia histórica deja de estar "activa" si el turno ya terminó,
-- fue anulado/recibido o su turno origen ya quedó cerrado/anulado.
UPDATE "Shift" emergency_shift
SET
  "emergencyReleasedAt" = COALESCE(
    emergency_shift."actualEnd",
    source."actualEnd",
    emergency_shift."updatedAt"
  ),
  "emergencyReleaseReason" = CASE
    WHEN emergency_shift."status" IN ('CERRADO', 'ANULADO', 'RECIBIDO')
      THEN 'El turno de emergencia ya no está abierto.'
    WHEN source."status" IN ('CERRADO', 'ANULADO')
      THEN 'El turno saliente que originó la emergencia quedó regularizado.'
    ELSE 'Regularización histórica v1.19.0.'
  END
FROM "Shift" source
WHERE emergency_shift."emergency" = TRUE
  AND emergency_shift."emergencyReleasedAt" IS NULL
  AND emergency_shift."emergencySourceShiftId" = source."id"
  AND (
    emergency_shift."status" IN ('CERRADO', 'ANULADO', 'RECIBIDO')
    OR source."status" IN ('CERRADO', 'ANULADO')
  );

-- Si una versión previa permitió encadenar más de una emergencia abierta,
-- conserva como excepción vigente sólo la apertura más reciente. Las anteriores
-- siguen existiendo y auditándose; únicamente se libera su condición activa.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      ORDER BY COALESCE("actualStart", "createdAt") DESC, "createdAt" DESC
    ) AS rn
  FROM "Shift"
  WHERE "emergency" = TRUE
    AND "emergencyReleasedAt" IS NULL
    AND "archivedAt" IS NULL
    AND "status" IN ('INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA', 'ENTREGA_ENVIADA')
)
UPDATE "Shift" s
SET
  "emergencyReleasedAt" = NOW(),
  "emergencyReleaseReason" =
    'Regularización v1.19.0: sólo puede existir un turno de emergencia abierto.'
FROM ranked r
WHERE s."id" = r."id"
  AND r.rn > 1;

DROP INDEX IF EXISTS "Shift_emergency_archivedAt_idx";

CREATE INDEX "Shift_emergency_emergencyReleasedAt_archivedAt_idx"
  ON "Shift"("emergency", "emergencyReleasedAt", "archivedAt");

-- Barrera física: ni doble clic, ni dos usuarios, ni una futura regresión
-- pueden dejar dos turnos de emergencia abiertos a la vez.
CREATE UNIQUE INDEX "Shift_one_open_emergency"
  ON "Shift" ((1))
  WHERE "emergency" = TRUE
    AND "emergencyReleasedAt" IS NULL
    AND "archivedAt" IS NULL
    AND "status" IN ('INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA', 'ENTREGA_ENVIADA');
