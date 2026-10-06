-- Custodia opcional de una ubicación de inventario (p. ej. carro asignado).
-- No mueve existencias ni cambia propiedad; sólo añade contexto operativo.
ALTER TABLE "InventoryLocation" ADD COLUMN "custodianUserId" TEXT;

ALTER TABLE "InventoryLocation"
  ADD CONSTRAINT "InventoryLocation_custodianUserId_fkey"
  FOREIGN KEY ("custodianUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "InventoryLocation_custodianUserId_active_idx"
  ON "InventoryLocation"("custodianUserId", "active");
