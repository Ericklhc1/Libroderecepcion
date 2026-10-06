-- Garantías parciales sucesivas: migración aditiva y compatible.
-- No reescribe hechos históricos ni cambia saldos previos.
CREATE TYPE "GuaranteeSettlementKind" AS ENUM ('DEVOLUCION', 'COBRO');

ALTER TABLE "Guarantee"
  ADD COLUMN "returnedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "GuaranteeSettlement" (
  "id" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "guaranteeId" TEXT NOT NULL,
  "kind" "GuaranteeSettlementKind" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "shiftId" TEXT,
  "cashMovementId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GuaranteeSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuaranteeSettlement_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "GuaranteeSettlement_reason_check" CHECK (length(trim("reason")) >= 3)
);

CREATE UNIQUE INDEX "GuaranteeSettlement_requestKey_key"
  ON "GuaranteeSettlement"("requestKey");
CREATE UNIQUE INDEX "GuaranteeSettlement_cashMovementId_key"
  ON "GuaranteeSettlement"("cashMovementId");
CREATE INDEX "GuaranteeSettlement_guaranteeId_createdAt_idx"
  ON "GuaranteeSettlement"("guaranteeId","createdAt");
CREATE INDEX "GuaranteeSettlement_createdById_createdAt_idx"
  ON "GuaranteeSettlement"("createdById","createdAt");

ALTER TABLE "GuaranteeSettlement"
  ADD CONSTRAINT "GuaranteeSettlement_guaranteeId_fkey"
  FOREIGN KEY ("guaranteeId") REFERENCES "Guarantee"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GuaranteeSettlement"
  ADD CONSTRAINT "GuaranteeSettlement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
