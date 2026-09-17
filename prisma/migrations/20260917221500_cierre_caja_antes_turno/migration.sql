-- Cierre de Caja independiente del cierre de Turno.
-- La fotografía queda congelada para auditoría y el turno sólo puede cerrarse
-- después de que Caja haya quedado confirmada cuando existe fondo operativo.
CREATE TABLE IF NOT EXISTS "ShiftCashClosure" (
  "id" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "closedById" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshot" JSONB NOT NULL,
  "notes" TEXT,
  "reopenedAt" TIMESTAMP(3),
  "reopenedById" TEXT,
  "reopenReason" TEXT,

  CONSTRAINT "ShiftCashClosure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShiftCashClosure_shiftId_key"
  ON "ShiftCashClosure"("shiftId");
CREATE INDEX IF NOT EXISTS "ShiftCashClosure_closedAt_idx"
  ON "ShiftCashClosure"("closedAt");

DO $$ BEGIN
  ALTER TABLE "ShiftCashClosure"
    ADD CONSTRAINT "ShiftCashClosure_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftCashClosure"
    ADD CONSTRAINT "ShiftCashClosure_closedById_fkey"
    FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShiftCashClosure"
    ADD CONSTRAINT "ShiftCashClosure_reopenedById_fkey"
    FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Invariante de base de datos: ninguna ruta de código puede saltarse Caja al
-- cerrar definitivamente un turno. La entrega puede enviarse antes: es el paso
-- final CERRADO el que exige Caja confirmada. Si el hotel no tiene fondo
-- activo, Caja está deshabilitada y no se introduce un bloqueo artificial.
CREATE OR REPLACE FUNCTION "require_shift_cash_closure"()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'CERRADO'
     AND NEW."status" IS DISTINCT FROM OLD."status"
     AND EXISTS (SELECT 1 FROM "CashFund" f WHERE f."active" = TRUE)
     AND NOT EXISTS (
       SELECT 1
       FROM "ShiftCashClosure" c
       WHERE c."shiftId" = NEW."id" AND c."reopenedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Antes de cerrar el turno debes cerrar Caja.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Shift_caja_cerrada_antes_de_entregar" ON "Shift";
DROP TRIGGER IF EXISTS "Shift_caja_cerrada_antes_de_cerrar" ON "Shift";
CREATE TRIGGER "Shift_caja_cerrada_antes_de_cerrar"
BEFORE UPDATE OF "status" ON "Shift"
FOR EACH ROW EXECUTE FUNCTION "require_shift_cash_closure"();