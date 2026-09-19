-- Todo egreso a tesorería se refleja en la Caja central.
-- Nullable para conservar históricos y permitir el estado pendiente de aprobación.
ALTER TABLE "CashMovement"
  ADD COLUMN "cashTransferId" TEXT;

CREATE UNIQUE INDEX "CashMovement_cashTransferId_key"
  ON "CashMovement"("cashTransferId");

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_cashTransferId_fkey"
  FOREIGN KEY ("cashTransferId") REFERENCES "CashTransfer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: los egresos ya existentes también deben afectar el saldo central.
INSERT INTO "CashMovement" (
  "id", "kind", "direction", "currency", "amount", "shiftId",
  "cashTransferId", "createdById", "reference", "notes", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  'TESORERIA',
  'SALIDA',
  t."currency",
  t."amount",
  h."fromShiftId",
  t."id",
  t."createdById",
  CASE
    WHEN t."reference" IS NULL OR btrim(t."reference") = ''
      THEN 'Egreso a tesorería'
    ELSE 'Tesorería · ' || t."reference"
  END,
  t."notes",
  t."createdAt"
FROM "CashTransfer" t
JOIN "ShiftHandover" h ON h."id" = t."handoverId"
LEFT JOIN "CashMovement" m ON m."cashTransferId" = t."id"
WHERE m."id" IS NULL;
