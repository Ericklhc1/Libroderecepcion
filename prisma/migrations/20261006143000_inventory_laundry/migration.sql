-- Inventario común y lavandería.
-- Migración aditiva: no crea stock, categorías ni folios operativos por defecto.
CREATE TYPE "InventoryBehavior" AS ENUM ('CONSUMIBLE','PRESTAMO','LAVABLE','ACTIVO');
CREATE TYPE "InventoryMovementKind" AS ENUM ('ENTRADA','TRASLADO','DEVOLUCION','USO','REPARACION','REPROCESO','BAJA','CORRECCION');
CREATE TYPE "InventoryLocationKind" AS ENUM ('BODEGA','CARRO','AREA','HABITACION','LAVANDERIA','REPARACION','OTRO');
CREATE TYPE "LaundryShipmentStatus" AS ENUM ('PREPARADO','ENTREGADO','PARCIAL','RECIBIDO_DIFERENCIAS','RECIBIDO','CERRADO');

CREATE TABLE "InventoryCategory" (
  "id" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryCategory_name_check" CHECK (length(trim("name")) >= 2)
);

CREATE TABLE "InventoryItem" (
  "id" TEXT NOT NULL,
  "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass),
  "categoryId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "behavior" "InventoryBehavior" NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'pieza',
  "presentation" TEXT,
  "trackIndividually" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "cost" DECIMAL(12,2),
  "costCurrency" VARCHAR(3),
  "replacementEstimate" DECIMAL(12,2),
  "replacementCurrency" VARCHAR(3),
  "replacementSource" TEXT,
  "replacementDate" DATE,
  "accountingValue" DECIMAL(12,2),
  "accountingCurrency" VARCHAR(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryItem_name_check" CHECK (length(trim("name")) >= 2),
  CONSTRAINT "InventoryItem_code_check" CHECK (length(trim("code")) >= 2),
  CONSTRAINT "InventoryItem_value_check" CHECK (
    ("cost" IS NULL OR "cost" >= 0) AND
    ("replacementEstimate" IS NULL OR "replacementEstimate" >= 0) AND
    ("accountingValue" IS NULL OR "accountingValue" >= 0)
  )
);

CREATE TABLE "InventoryLocation" (
  "id" TEXT NOT NULL,
  "key" TEXT,
  "departmentId" TEXT,
  "name" TEXT NOT NULL,
  "kind" "InventoryLocationKind" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryLocation_name_check" CHECK (length(trim("name")) >= 2)
);

CREATE TABLE "InventoryBalance" (
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("itemId","locationId"),
  CONSTRAINT "InventoryBalance_nonnegative_check" CHECK ("quantity" >= 0)
);

CREATE TABLE "InventoryAsset" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "internalCode" TEXT NOT NULL,
  "currentLocationId" TEXT,
  "custodianUserId" TEXT,
  "condition" TEXT NOT NULL DEFAULT 'OPERATIVO',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LaundryShipment" (
  "id" TEXT NOT NULL,
  "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass),
  "folio" SERIAL NOT NULL,
  "requestKey" TEXT NOT NULL,
  "status" "LaundryShipmentStatus" NOT NULL DEFAULT 'PREPARADO',
  "originLocationId" TEXT NOT NULL,
  "laundryLocationId" TEXT NOT NULL,
  "preparedById" TEXT NOT NULL,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredById" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "receivedById" TEXT,
  "receivedAt" TIMESTAMP(3),
  "differenceEntryId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LaundryShipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LaundryShipment_locations_check" CHECK ("originLocationId" <> "laundryLocationId")
);

CREATE TABLE "LaundryShipmentLine" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "sentQuantity" INTEGER NOT NULL,
  "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  "conformingQuantity" INTEGER NOT NULL DEFAULT 0,
  "reprocessQuantity" INTEGER NOT NULL DEFAULT 0,
  "weightSentKg" DECIMAL(10,3),
  "weightReceivedKg" DECIMAL(10,3),
  "notes" TEXT,
  CONSTRAINT "LaundryShipmentLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LaundryShipmentLine_quantities_check" CHECK (
    "sentQuantity" > 0 AND
    "receivedQuantity" >= 0 AND
    "conformingQuantity" >= 0 AND
    "reprocessQuantity" >= 0 AND
    "receivedQuantity" <= "sentQuantity" AND
    "conformingQuantity" + "reprocessQuantity" <= "receivedQuantity"
  ),
  CONSTRAINT "LaundryShipmentLine_weights_check" CHECK (
    ("weightSentKg" IS NULL OR "weightSentKg" >= 0) AND
    ("weightReceivedKg" IS NULL OR "weightReceivedKg" >= 0)
  )
);

CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL,
  "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass),
  "requestKey" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "assetId" TEXT,
  "kind" "InventoryMovementKind" NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "fromLocationId" TEXT,
  "toLocationId" TEXT,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "laundryShipmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "InventoryMovement_reason_check" CHECK (length(trim("reason")) >= 3),
  CONSTRAINT "InventoryMovement_locations_check" CHECK (
    "fromLocationId" IS NOT NULL OR "toLocationId" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "InventoryCategory_departmentId_name_key" ON "InventoryCategory"("departmentId","name");
CREATE INDEX "InventoryCategory_departmentId_active_idx" ON "InventoryCategory"("departmentId","active");
CREATE UNIQUE INDEX "InventoryItem_humanId_key" ON "InventoryItem"("humanId");
CREATE UNIQUE INDEX "InventoryItem_code_key" ON "InventoryItem"("code");
CREATE INDEX "InventoryItem_categoryId_active_idx" ON "InventoryItem"("categoryId","active");
CREATE INDEX "InventoryItem_behavior_active_idx" ON "InventoryItem"("behavior","active");
CREATE UNIQUE INDEX "InventoryLocation_key_key" ON "InventoryLocation"("key");
CREATE INDEX "InventoryLocation_departmentId_active_idx" ON "InventoryLocation"("departmentId","active");
CREATE INDEX "InventoryLocation_kind_active_idx" ON "InventoryLocation"("kind","active");
CREATE INDEX "InventoryBalance_locationId_idx" ON "InventoryBalance"("locationId");
CREATE UNIQUE INDEX "InventoryAsset_internalCode_key" ON "InventoryAsset"("internalCode");
CREATE INDEX "InventoryAsset_itemId_active_idx" ON "InventoryAsset"("itemId","active");
CREATE INDEX "InventoryAsset_currentLocationId_idx" ON "InventoryAsset"("currentLocationId");
CREATE INDEX "InventoryAsset_custodianUserId_idx" ON "InventoryAsset"("custodianUserId");
CREATE UNIQUE INDEX "InventoryMovement_humanId_key" ON "InventoryMovement"("humanId");
CREATE UNIQUE INDEX "InventoryMovement_requestKey_key" ON "InventoryMovement"("requestKey");
CREATE INDEX "InventoryMovement_itemId_createdAt_idx" ON "InventoryMovement"("itemId","createdAt");
CREATE INDEX "InventoryMovement_fromLocationId_createdAt_idx" ON "InventoryMovement"("fromLocationId","createdAt");
CREATE INDEX "InventoryMovement_toLocationId_createdAt_idx" ON "InventoryMovement"("toLocationId","createdAt");
CREATE INDEX "InventoryMovement_laundryShipmentId_idx" ON "InventoryMovement"("laundryShipmentId");
CREATE UNIQUE INDEX "LaundryShipment_humanId_key" ON "LaundryShipment"("humanId");
CREATE UNIQUE INDEX "LaundryShipment_folio_key" ON "LaundryShipment"("folio");
CREATE UNIQUE INDEX "LaundryShipment_requestKey_key" ON "LaundryShipment"("requestKey");
CREATE UNIQUE INDEX "LaundryShipment_differenceEntryId_key" ON "LaundryShipment"("differenceEntryId");
CREATE INDEX "LaundryShipment_status_createdAt_idx" ON "LaundryShipment"("status","createdAt");
CREATE INDEX "LaundryShipment_originLocationId_createdAt_idx" ON "LaundryShipment"("originLocationId","createdAt");
CREATE INDEX "LaundryShipment_laundryLocationId_createdAt_idx" ON "LaundryShipment"("laundryLocationId","createdAt");
CREATE UNIQUE INDEX "LaundryShipmentLine_shipmentId_itemId_key" ON "LaundryShipmentLine"("shipmentId","itemId");
CREATE INDEX "LaundryShipmentLine_itemId_idx" ON "LaundryShipmentLine"("itemId");

ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "InventoryCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_currentLocationId_fkey"
  FOREIGN KEY ("currentLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_custodianUserId_fkey"
  FOREIGN KEY ("custodianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaundryShipment" ADD CONSTRAINT "LaundryShipment_originLocationId_fkey"
  FOREIGN KEY ("originLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaundryShipment" ADD CONSTRAINT "LaundryShipment_laundryLocationId_fkey"
  FOREIGN KEY ("laundryLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaundryShipment" ADD CONSTRAINT "LaundryShipment_preparedById_fkey"
  FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaundryShipment" ADD CONSTRAINT "LaundryShipment_deliveredById_fkey"
  FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaundryShipment" ADD CONSTRAINT "LaundryShipment_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaundryShipment" ADD CONSTRAINT "LaundryShipment_differenceEntryId_fkey"
  FOREIGN KEY ("differenceEntryId") REFERENCES "OperationalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaundryShipmentLine" ADD CONSTRAINT "LaundryShipmentLine_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "LaundryShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaundryShipmentLine" ADD CONSTRAINT "LaundryShipmentLine_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "InventoryAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_fromLocationId_fkey"
  FOREIGN KEY ("fromLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_toLocationId_fkey"
  FOREIGN KEY ("toLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_laundryShipmentId_fkey"
  FOREIGN KEY ("laundryShipmentId") REFERENCES "LaundryShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Misma fuente de autorización: catálogo RBAC existente.
INSERT INTO "Permission" ("id","key","name","group") VALUES
  ('perm_inventory_view','inventory.view','Consultar inventario común y disponibilidad','Inventario'),
  ('perm_inventory_move','inventory.move','Registrar movimientos físicos dentro de mi alcance','Inventario'),
  ('perm_inventory_manage','inventory.manage','Administrar categorías, artículos, ubicaciones y valorización','Inventario'),
  ('perm_laundry_manage','laundry.manage','Preparar, entregar y recibir folios de lavandería','Inventario')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT r."id",p."id"
FROM "Role" r CROSS JOIN "Permission" p
WHERE
  (r."key"='ADMINISTRADOR_SISTEMA' AND p."key" IN ('inventory.view','inventory.move','inventory.manage','laundry.manage'))
  OR (r."key"='SUPERVISOR' AND p."key" IN ('inventory.view','inventory.move','inventory.manage','laundry.manage'))
  OR (r."key"='RECEPCIONISTA' AND p."key"='inventory.view')
  OR (r."key"='AUDITOR_NOCTURNO' AND p."key"='inventory.view')
  OR (r."key"='MUCAMA' AND p."key" IN ('inventory.view','inventory.move'))
  OR (r."key"='SUPERVISOR_HOUSEKEEPING' AND p."key" IN ('inventory.view','inventory.move','laundry.manage'))
  OR (r."key"='AMA_DE_LLAVES' AND p."key" IN ('inventory.view','inventory.move','inventory.manage','laundry.manage'))
  OR (r."key"='GERENCIA' AND p."key"='inventory.view')
ON CONFLICT DO NOTHING;
