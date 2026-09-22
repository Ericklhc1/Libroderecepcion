-- La Caja se arquea contra el efectivo físico esperado, no sólo contra el fondo fijo.
-- El snapshot congela esa composición al firmar el conteo para que movimientos
-- posteriores (por ejemplo una transferencia a Tesorería) no reescriban el pasado.

ALTER TABLE "CashCount"
  ADD COLUMN "expectedSnapshot" JSONB;
