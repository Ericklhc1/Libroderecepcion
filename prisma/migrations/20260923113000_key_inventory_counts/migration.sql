-- Acciones del inventario físico. Son aditivas y conservan los valores históricos.
ALTER TYPE "KeyAction" ADD VALUE IF NOT EXISTS 'INGRESO_INVENTARIO';
ALTER TYPE "KeyAction" ADD VALUE IF NOT EXISTS 'BAJA';
ALTER TYPE "KeyAction" ADD VALUE IF NOT EXISTS 'AJUSTE_INVENTARIO';

-- Inventario físico autónomo de llaves por piso.
-- Cambio aditivo: no elimina ni modifica datos históricos de PMS/estadías.

CREATE TABLE "KeyInventoryCount" (
  "id" TEXT NOT NULL,
  "floor" INTEGER NOT NULL,
  "countedById" TEXT NOT NULL,
  "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,

  CONSTRAINT "KeyInventoryCount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeyInventoryItem" (
  "id" TEXT NOT NULL,
  "countId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "expected" INTEGER NOT NULL,
  "found" INTEGER NOT NULL,
  "outOfService" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,

  CONSTRAINT "KeyInventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KeyInventoryCount_floor_countedAt_idx"
  ON "KeyInventoryCount"("floor", "countedAt");

CREATE INDEX "KeyInventoryCount_countedById_countedAt_idx"
  ON "KeyInventoryCount"("countedById", "countedAt");

CREATE UNIQUE INDEX "KeyInventoryItem_countId_roomId_key"
  ON "KeyInventoryItem"("countId", "roomId");

CREATE INDEX "KeyInventoryItem_roomId_idx"
  ON "KeyInventoryItem"("roomId");

ALTER TABLE "KeyInventoryCount"
  ADD CONSTRAINT "KeyInventoryCount_countedById_fkey"
  FOREIGN KEY ("countedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KeyInventoryItem"
  ADD CONSTRAINT "KeyInventoryItem_countId_fkey"
  FOREIGN KEY ("countId") REFERENCES "KeyInventoryCount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeyInventoryItem"
  ADD CONSTRAINT "KeyInventoryItem_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
