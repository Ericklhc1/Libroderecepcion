-- Caja con fondo fijo, arqueo por denominación y elementos de la entrega.
--
-- COMPATIBILIDAD: puramente ADITIVA. Sólo crea tablas y enumeraciones nuevas;
-- no toca ninguna columna existente. `ShiftHandover` gana relaciones, que en
-- PostgreSQL viven en las tablas nuevas, así que la tabla no se altera.
--
-- LA EXIGENCIA SE ACTIVA CON EL FONDO. Mientras no exista una fila activa en
-- `CashFund`, la entrega y la recepción de turno funcionan exactamente como
-- antes. Al final de este archivo se siembra el fondo de ESTE hotel —CLP
-- 100.000 y USD 150— y con eso el arqueo pasa a ser obligatorio. Un despliegue
-- distinto que no quiera caja sólo tiene que no tener fondos.
--
-- REVERSIBLE: eliminar las ocho tablas nuevas devuelve el esquema al estado
-- anterior sin tocar un solo dato operativo.

-- CreateEnum
CREATE TYPE "CashMedium" AS ENUM ('BILLETE', 'MONEDA');

-- CreateEnum
CREATE TYPE "CashCountKind" AS ENUM ('DECLARADO', 'CONFIRMADO');

-- CreateTable
CREATE TABLE "CashDenomination" (
    "id" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "medium" "CashMedium" NOT NULL DEFAULT 'BILLETE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CashDenomination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashFund" (
    "id" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCount" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "kind" "CashCountKind" NOT NULL,
    "countedById" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "CashCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "denominationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "CashCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTransfer" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverElementType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HandoverElementType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverElement" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "elementTypeId" TEXT NOT NULL,
    "declared" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoverElement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashDenomination_currency_active_idx" ON "CashDenomination"("currency", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CashDenomination_currency_value_key" ON "CashDenomination"("currency", "value");

-- CreateIndex
CREATE UNIQUE INDEX "CashFund_currency_key" ON "CashFund"("currency");

-- CreateIndex
CREATE INDEX "CashCount_handoverId_idx" ON "CashCount"("handoverId");

-- CreateIndex
CREATE UNIQUE INDEX "CashCount_handoverId_kind_key" ON "CashCount"("handoverId", "kind");

-- CreateIndex
CREATE INDEX "CashCountLine_denominationId_idx" ON "CashCountLine"("denominationId");

-- CreateIndex
CREATE UNIQUE INDEX "CashCountLine_countId_denominationId_key" ON "CashCountLine"("countId", "denominationId");

-- CreateIndex
CREATE INDEX "CashTransfer_handoverId_idx" ON "CashTransfer"("handoverId");

-- CreateIndex
CREATE INDEX "CashTransfer_currency_idx" ON "CashTransfer"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverElementType_name_key" ON "HandoverElementType"("name");

-- CreateIndex
CREATE INDEX "HandoverElement_handoverId_idx" ON "HandoverElement"("handoverId");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverElement_handoverId_elementTypeId_key" ON "HandoverElement"("handoverId", "elementTypeId");

-- AddForeignKey
ALTER TABLE "CashFund" ADD CONSTRAINT "CashFund_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "ShiftHandover"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCountLine" ADD CONSTRAINT "CashCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "CashCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCountLine" ADD CONSTRAINT "CashCountLine_denominationId_fkey" FOREIGN KEY ("denominationId") REFERENCES "CashDenomination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransfer" ADD CONSTRAINT "CashTransfer_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "ShiftHandover"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransfer" ADD CONSTRAINT "CashTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverElement" ADD CONSTRAINT "HandoverElement_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "ShiftHandover"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverElement" ADD CONSTRAINT "HandoverElement_elementTypeId_fkey" FOREIGN KEY ("elementTypeId") REFERENCES "HandoverElementType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Datos de este hotel. Todo con ON CONFLICT DO NOTHING: la migración se puede
-- volver a aplicar sin duplicar nada y sin pisar lo que alguien haya editado
-- después desde /admin/parametros.
-- ===========================================================================

-- Denominaciones en circulación. También las siembra `seedCatalog`, porque son
-- catálogo; acá van para que una base YA instalada las tenga sin resembrar.
INSERT INTO "CashDenomination" ("id", "currency", "value", "medium", "active", "order")
VALUES
  (gen_random_uuid()::text, 'CLP', 20000, 'BILLETE', true, 0),
  (gen_random_uuid()::text, 'CLP', 10000, 'BILLETE', true, 1),
  (gen_random_uuid()::text, 'CLP',  5000, 'BILLETE', true, 2),
  (gen_random_uuid()::text, 'CLP',  2000, 'BILLETE', true, 3),
  (gen_random_uuid()::text, 'CLP',  1000, 'BILLETE', true, 4),
  (gen_random_uuid()::text, 'CLP',   500, 'MONEDA',  true, 5),
  (gen_random_uuid()::text, 'CLP',   100, 'MONEDA',  true, 6),
  (gen_random_uuid()::text, 'CLP',    50, 'MONEDA',  true, 7),
  (gen_random_uuid()::text, 'CLP',    10, 'MONEDA',  true, 8),
  (gen_random_uuid()::text, 'USD',   100, 'BILLETE', true, 9),
  (gen_random_uuid()::text, 'USD',    50, 'BILLETE', true, 10),
  (gen_random_uuid()::text, 'USD',    20, 'BILLETE', true, 11),
  (gen_random_uuid()::text, 'USD',    10, 'BILLETE', true, 12),
  (gen_random_uuid()::text, 'USD',     5, 'BILLETE', true, 13),
  (gen_random_uuid()::text, 'USD',     1, 'BILLETE', true, 14)
ON CONFLICT ("currency", "value") DO NOTHING;

-- Fondo fijo: lo que SIEMPRE debe quedar en el cajón al entregar el turno.
INSERT INTO "CashFund" ("id", "currency", "amount", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'CLP', 100000, true, NOW(), NOW()),
  (gen_random_uuid()::text, 'USD',    150, true, NOW(), NOW())
ON CONFLICT ("currency") DO NOTHING;

-- Elementos que se traspasan con la caja. Punto de partida editable: el hotel
-- agrega y quita desde /admin/parametros.
INSERT INTO "HandoverElementType" ("id", "name", "detail", "required", "active", "order")
VALUES
  (gen_random_uuid()::text, 'Llaves maestras', 'Maestra de piso y llaves de áreas comunes.', true, true, 0),
  (gen_random_uuid()::text, 'Radio de turno', 'Equipo de comunicación con su batería.', true, true, 1),
  (gen_random_uuid()::text, 'Objetos olvidados', 'Lo que quedó en custodia de huéspedes.', true, true, 2),
  (gen_random_uuid()::text, 'Encomiendas y paquetes', 'Recibidos y aún no entregados.', true, true, 3)
ON CONFLICT ("name") DO NOTHING;
