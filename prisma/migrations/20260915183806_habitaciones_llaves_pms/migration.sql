-- CreateEnum
CREATE TYPE "RoomStayStatus" AS ENUM ('CHECK_IN', 'IN_HOUSE', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "RoomStayStage" AS ENUM ('PENDIENTE', 'CONFIRMADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "PmsReportKind" AS ENUM ('ENTRADAS', 'IN_HOUSE', 'SALIDAS');

-- CreateEnum
CREATE TYPE "KeyType" AS ENUM ('PRINCIPAL', 'COPIA', 'MAESTRA');

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('DISPONIBLE', 'ASIGNADA', 'COPIA_ADICIONAL', 'PENDIENTE_DEVOLUCION', 'EXTRAVIADA', 'FUERA_DE_SERVICIO');

-- CreateEnum
CREATE TYPE "KeyAction" AS ENUM ('CREADA', 'ASIGNADA', 'DEVUELTA', 'COPIA_ENTREGADA', 'COPIA_RECUPERADA', 'MARCADA_PENDIENTE_DEVOLUCION', 'MARCADA_EXTRAVIADA', 'MARCADA_FUERA_DE_SERVICIO', 'REINTEGRADA');

-- CreateEnum
CREATE TYPE "PmsImportStatus" AS ENUM ('BORRADOR', 'APLICADO', 'DESCARTADO');

-- AlterTable
ALTER TABLE "OperationalEntry" ADD COLUMN     "roomId" TEXT;

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" INTEGER,
    "kind" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomStay" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT,
    "guestNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channel" TEXT,
    "arrivalDate" DATE,
    "departureDate" DATE,
    "pmsStatus" TEXT,
    "sourceReport" "PmsReportKind" NOT NULL,
    "status" "RoomStayStatus" NOT NULL,
    "stage" "RoomStayStage" NOT NULL DEFAULT 'PENDIENTE',
    "businessDate" DATE NOT NULL,
    "batchId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "note" TEXT,
    "touchedManually" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deletionReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RoomStay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomKey" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "KeyType" NOT NULL DEFAULT 'PRINCIPAL',
    "status" "KeyStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "roomId" TEXT,
    "stayId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "assignedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyMovement" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "action" "KeyAction" NOT NULL,
    "fromStatus" "KeyStatus",
    "toStatus" "KeyStatus" NOT NULL,
    "roomId" TEXT,
    "stayId" TEXT,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmsImportBatch" (
    "id" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "PmsImportStatus" NOT NULL DEFAULT 'BORRADOR',
    "reports" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "discardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PmsImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_number_key" ON "Room"("number");

-- CreateIndex
CREATE INDEX "Room_active_idx" ON "Room"("active");

-- CreateIndex
CREATE INDEX "RoomStay_roomId_status_idx" ON "RoomStay"("roomId", "status");

-- CreateIndex
CREATE INDEX "RoomStay_businessDate_idx" ON "RoomStay"("businessDate");

-- CreateIndex
CREATE INDEX "RoomStay_stage_idx" ON "RoomStay"("stage");

-- CreateIndex
CREATE INDEX "RoomStay_deletedAt_idx" ON "RoomStay"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoomStay_businessDate_reservationId_roomId_status_key" ON "RoomStay"("businessDate", "reservationId", "roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoomKey_code_key" ON "RoomKey"("code");

-- CreateIndex
CREATE INDEX "RoomKey_status_idx" ON "RoomKey"("status");

-- CreateIndex
CREATE INDEX "RoomKey_roomId_type_idx" ON "RoomKey"("roomId", "type");

-- CreateIndex
CREATE INDEX "KeyMovement_keyId_at_idx" ON "KeyMovement"("keyId", "at");

-- CreateIndex
CREATE INDEX "KeyMovement_at_idx" ON "KeyMovement"("at");

-- CreateIndex
CREATE INDEX "PmsImportBatch_businessDate_idx" ON "PmsImportBatch"("businessDate");

-- CreateIndex
CREATE INDEX "PmsImportBatch_status_idx" ON "PmsImportBatch"("status");

-- CreateIndex
CREATE INDEX "OperationalEntry_roomId_idx" ON "OperationalEntry"("roomId");

-- AddForeignKey
ALTER TABLE "OperationalEntry" ADD CONSTRAINT "OperationalEntry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomStay" ADD CONSTRAINT "RoomStay_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomStay" ADD CONSTRAINT "RoomStay_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PmsImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomStay" ADD CONSTRAINT "RoomStay_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomKey" ADD CONSTRAINT "RoomKey_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomKey" ADD CONSTRAINT "RoomKey_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "RoomStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomKey" ADD CONSTRAINT "RoomKey_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyMovement" ADD CONSTRAINT "KeyMovement_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "RoomKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyMovement" ADD CONSTRAINT "KeyMovement_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyMovement" ADD CONSTRAINT "KeyMovement_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "RoomStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyMovement" ADD CONSTRAINT "KeyMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmsImportBatch" ADD CONSTRAINT "PmsImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PmsImportBatch" ADD CONSTRAINT "PmsImportBatch_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
