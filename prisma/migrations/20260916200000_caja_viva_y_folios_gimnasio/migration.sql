-- Caja viva y folios de gimnasio.
--
-- Dos decisiones deliberadas:
-- 1. el folio es un entero autoincremental independiente de cualquier otra
--    secuencia del Libro y se muestra con seis dígitos (000001..999999);
-- 2. Caja viva registra movimientos físicos durante el turno. El arqueo de
--    entrega sigue existiendo como control final, pero deja de ser el único
--    momento en que se puede observar la caja.

CREATE SEQUENCE IF NOT EXISTS "gym_pass_folio_seq"
  AS INTEGER
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 999999
  NO CYCLE;

CREATE TABLE IF NOT EXISTS "GymPass" (
  "id" TEXT NOT NULL,
  "folio" INTEGER NOT NULL DEFAULT nextval('"gym_pass_folio_seq"'),
  "reservationReferenceId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "guestName" TEXT NOT NULL,
  "receptionistId" TEXT NOT NULL,
  "shiftId" TEXT,
  "operationalEntryId" TEXT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'EMITIDO',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidReason" TEXT,

  CONSTRAINT "GymPass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GymPass_folio_range" CHECK ("folio" BETWEEN 1 AND 999999),
  CONSTRAINT "GymPass_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "GymPass_payment_method" CHECK ("paymentMethod" IN ('EFECTIVO','TARJETA','OTRO')),
  CONSTRAINT "GymPass_status" CHECK ("status" IN ('EMITIDO','ANULADO')),
  CONSTRAINT "GymPass_reservationReferenceId_fkey" FOREIGN KEY ("reservationReferenceId") REFERENCES "ReservationReference"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GymPass_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GymPass_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GymPass_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GymPass_operationalEntryId_fkey" FOREIGN KEY ("operationalEntryId") REFERENCES "OperationalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GymPass_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "GymPass_folio_key" ON "GymPass"("folio");
CREATE UNIQUE INDEX IF NOT EXISTS "GymPass_operationalEntryId_key" ON "GymPass"("operationalEntryId");
CREATE INDEX IF NOT EXISTS "GymPass_roomId_idx" ON "GymPass"("roomId");
CREATE INDEX IF NOT EXISTS "GymPass_reservationReferenceId_idx" ON "GymPass"("reservationReferenceId");
CREATE INDEX IF NOT EXISTS "GymPass_issuedAt_idx" ON "GymPass"("issuedAt");

CREATE TABLE IF NOT EXISTS "CashMovement" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "shiftId" TEXT,
  "roomId" TEXT,
  "reservationReferenceId" TEXT,
  "guaranteeId" TEXT,
  "gymPassId" TEXT,
  "createdById" TEXT NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidReason" TEXT,

  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashMovement_direction" CHECK ("direction" IN ('ENTRADA','SALIDA')),
  CONSTRAINT "CashMovement_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "CashMovement_kind" CHECK ("kind" IN ('GARANTIA_INGRESO','GARANTIA_DEVOLUCION','VENTA_GIMNASIO','ANULACION_GIMNASIO','AJUSTE_ENTRADA','AJUSTE_SALIDA')),
  CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashMovement_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashMovement_reservationReferenceId_fkey" FOREIGN KEY ("reservationReferenceId") REFERENCES "ReservationReference"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashMovement_guaranteeId_fkey" FOREIGN KEY ("guaranteeId") REFERENCES "Guarantee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashMovement_gymPassId_fkey" FOREIGN KEY ("gymPassId") REFERENCES "GymPass"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CashMovement_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CashMovement_createdAt_idx" ON "CashMovement"("createdAt");
CREATE INDEX IF NOT EXISTS "CashMovement_currency_idx" ON "CashMovement"("currency");
CREATE INDEX IF NOT EXISTS "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");
CREATE INDEX IF NOT EXISTS "CashMovement_roomId_idx" ON "CashMovement"("roomId");
CREATE INDEX IF NOT EXISTS "CashMovement_reservationReferenceId_idx" ON "CashMovement"("reservationReferenceId");
CREATE UNIQUE INDEX IF NOT EXISTS "CashMovement_guarantee_in_unique"
  ON "CashMovement"("guaranteeId", "kind")
  WHERE "guaranteeId" IS NOT NULL AND "kind" = 'GARANTIA_INGRESO' AND "voidedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "CashMovement_guarantee_out_unique"
  ON "CashMovement"("guaranteeId", "kind")
  WHERE "guaranteeId" IS NOT NULL AND "kind" = 'GARANTIA_DEVOLUCION' AND "voidedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "CashMovement_gym_sale_unique"
  ON "CashMovement"("gymPassId", "kind")
  WHERE "gymPassId" IS NOT NULL AND "kind" = 'VENTA_GIMNASIO' AND "voidedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "CashMovement_gym_void_unique"
  ON "CashMovement"("gymPassId", "kind")
  WHERE "gymPassId" IS NOT NULL AND "kind" = 'ANULACION_GIMNASIO' AND "voidedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "CashAudit" (
  "id" TEXT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "expectedAmount" DECIMAL(12,2) NOT NULL,
  "countedAmount" DECIMAL(12,2) NOT NULL,
  "difference" DECIMAL(12,2) NOT NULL,
  "countedById" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CashAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashAudit_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CashAudit_createdAt_idx" ON "CashAudit"("createdAt");
CREATE INDEX IF NOT EXISTS "CashAudit_currency_idx" ON "CashAudit"("currency");
