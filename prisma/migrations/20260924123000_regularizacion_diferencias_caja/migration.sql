-- Regularización de diferencias de Caja.
-- Un movimiento físico puede explicar un faltante/sobrante anterior sin crear
-- un nuevo monto esperado. Los movimientos históricos conservan el comportamiento
-- actual mediante DEFAULT TRUE.
ALTER TABLE "CashMovement"
  ADD COLUMN IF NOT EXISTS "affectsExpected" BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN "CashMovement"."affectsExpected" IS
  'TRUE: cambia el efectivo esperado. FALSE: regulariza una diferencia física previa sin alterar el esperado.';
