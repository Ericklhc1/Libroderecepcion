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
