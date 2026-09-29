-- Amplía los tipos de movimiento de Caja para distinguir:
-- 1) garantía cobrada/aplicada fuera de Caja viva;
-- 2) regularizaciones físicas de entrada/salida sin confundirlas con ajustes manuales.

ALTER TABLE "CashMovement" DROP CONSTRAINT IF EXISTS "CashMovement_kind";

ALTER TABLE "CashMovement"
  ADD CONSTRAINT "CashMovement_kind"
  CHECK ("kind" IN (
    'GARANTIA_INGRESO',
    'GARANTIA_DEVOLUCION',
    'GARANTIA_COBRO',
    'VENTA_GIMNASIO',
    'ANULACION_GIMNASIO',
    'TESORERIA',
    'AJUSTE_ENTRADA',
    'AJUSTE_SALIDA',
    'REGULARIZACION_ENTRADA',
    'REGULARIZACION_SALIDA'
  ));
