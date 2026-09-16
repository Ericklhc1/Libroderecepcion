-- Garantías como entidad, y vínculo opcional de la estadía con la reserva.
--
-- COMPATIBILIDAD: esta migración es puramente ADITIVA. No elimina ni renombra
-- nada, y todo lo que agrega es nullable o tiene valor por omisión, de modo
-- que las filas existentes siguen siendo válidas sin tocarlas.
--
--   · ReservationReference.guaranteeStatus y balanceDue SE CONSERVAN. El motor
--     de alertas y la entrega de turno los siguen leyendo igual. Guarantee pasa
--     a ser la fuente de la garantía y el resumen se mantiene sincronizado por
--     un único camino de escritura, así que nada de lo que ya funcionaba cambia.
--   · RoomStay.reservationId y guestNames SE CONSERVAN: son la fotografía de
--     lo que entregó el PMS. reservationRefId es un vínculo OPCIONAL que se
--     resuelve por CÓDIGO de reserva, nunca por nombre, y queda nulo cuando la
--     reserva no existe en el sistema.
--   · Los dos valores nuevos de AlertType no se usan en esta migración, así que
--     no hay problema con agregarlos dentro de la transacción.
--
-- REVERSIBLE: eliminar la tabla Guarantee y las dos columnas nuevas devuelve el
-- esquema al estado anterior. Los valores agregados a un enum de PostgreSQL no
-- se pueden quitar, pero dejar de usarlos es inocuo.

-- CreateEnum
CREATE TYPE "GuaranteeState" AS ENUM ('PENDIENTE', 'VIGENTE', 'DEVUELTA', 'APLICADA_PARCIALMENTE', 'MULTA', 'CERRADA');

-- CreateEnum
CREATE TYPE "GuaranteeKind" AS ENUM ('TARJETA', 'EFECTIVO', 'TRANSFERENCIA', 'VOUCHER', 'CARTA_EMPRESA', 'OTRO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'GARANTIA_SIN_RESOLVER_EN_SALIDA';
ALTER TYPE "AlertType" ADD VALUE 'SALDO_PENDIENTE';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "guaranteeId" TEXT;

-- AlterTable
ALTER TABLE "RoomStay" ADD COLUMN     "reservationRefId" TEXT;

-- CreateTable
CREATE TABLE "Guarantee" (
    "id" TEXT NOT NULL,
    "reservationReferenceId" TEXT NOT NULL,
    "kind" "GuaranteeKind" NOT NULL DEFAULT 'TARJETA',
    "state" "GuaranteeState" NOT NULL DEFAULT 'PENDIENTE',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CLP',
    "appliedAmount" DECIMAL(12,2),
    "applicationReason" TEXT,
    "penaltyAmount" DECIMAL(12,2),
    "returnedAt" TIMESTAMP(3),
    "returnedById" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletionReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Guarantee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Guarantee_reservationReferenceId_idx" ON "Guarantee"("reservationReferenceId");

-- CreateIndex
CREATE INDEX "Guarantee_state_idx" ON "Guarantee"("state");

-- CreateIndex
CREATE INDEX "Guarantee_deletedAt_idx" ON "Guarantee"("deletedAt");

-- CreateIndex
CREATE INDEX "Alert_guaranteeId_idx" ON "Alert"("guaranteeId");

-- CreateIndex
CREATE INDEX "RoomStay_reservationRefId_idx" ON "RoomStay"("reservationRefId");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_guaranteeId_fkey" FOREIGN KEY ("guaranteeId") REFERENCES "Guarantee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomStay" ADD CONSTRAINT "RoomStay_reservationRefId_fkey" FOREIGN KEY ("reservationRefId") REFERENCES "ReservationReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guarantee" ADD CONSTRAINT "Guarantee_reservationReferenceId_fkey" FOREIGN KEY ("reservationReferenceId") REFERENCES "ReservationReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guarantee" ADD CONSTRAINT "Guarantee_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guarantee" ADD CONSTRAINT "Guarantee_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guarantee" ADD CONSTRAINT "Guarantee_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
