-- Multas: el formulario real del hotel.
--
-- Los campos son los que ya se usaban en papel, con el mismo nombre, porque
-- el papel llevaba años funcionando: número de reserva, habitación, huésped,
-- tipo de blanco afectado, tipo de mancha identificada, por qué procede el
-- cobro y qué dijo el huésped al negarse.
--
-- `guestStatement` es un campo propio y no una nota suelta a propósito: cuando
-- el cobro se discute, lo que decide es haber registrado su versión en el
-- momento, no recordarla después.
--
-- NO reemplaza a `Guarantee`. Una multa puede cobrarse contra una garantía
-- —ése es el estado MULTA que ya existía— y entonces las dos se enlazan por
-- `Fine.guaranteeId`.
--
-- `reservationCode` es TEXTO y no número: el PMS puede cambiar el formato y un
-- cero a la izquierda no se pierde.
--
-- COMPATIBILIDAD: puramente ADITIVA. Una tabla y tres enumeraciones nuevas;
-- ninguna columna existente se toca.
--
-- REVERSIBLE: eliminar la tabla y las tres enumeraciones.

-- CreateEnum
CREATE TYPE "FineKind" AS ENUM ('BLANCO', 'DANO', 'FALTANTE', 'OTRO');

-- CreateEnum
CREATE TYPE "LinenKind" AS ENUM ('TOALLA_MANO', 'TOALLA_CUERPO', 'TOALLA_PISO', 'SABANA', 'FUNDA_ALMOHADA', 'CUBRECAMA', 'PROTECTOR_COLCHON', 'BATA', 'MANTEL', 'CORTINA', 'OTRO');

-- CreateEnum
CREATE TYPE "FineStatus" AS ENUM ('REGISTRADA', 'NOTIFICADA', 'COBRADA', 'CONDONADA', 'ANULADA');

-- CreateTable
CREATE TABLE "Fine" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "reservationCode" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "stayId" TEXT,
    "reservationReferenceId" TEXT,
    "kind" "FineKind" NOT NULL DEFAULT 'BLANCO',
    "linenKind" "LinenKind",
    "itemDetail" TEXT,
    "stainType" TEXT,
    "reason" TEXT NOT NULL,
    "guestStatement" TEXT,
    "amount" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CLP',
    "status" "FineStatus" NOT NULL DEFAULT 'REGISTRADA',
    "guaranteeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletionReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Fine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fine_roomId_idx" ON "Fine"("roomId");

-- CreateIndex
CREATE INDEX "Fine_status_deletedAt_idx" ON "Fine"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Fine_reservationCode_idx" ON "Fine"("reservationCode");

-- AddForeignKey
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "RoomStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_reservationReferenceId_fkey" FOREIGN KEY ("reservationReferenceId") REFERENCES "ReservationReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_guaranteeId_fkey" FOREIGN KEY ("guaranteeId") REFERENCES "Guarantee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

