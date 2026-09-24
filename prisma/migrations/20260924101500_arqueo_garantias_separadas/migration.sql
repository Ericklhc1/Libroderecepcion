-- El arqueo por denominación verifica exclusivamente el fondo fijo.
-- Las garantías en efectivo se validan por separado y quedan congeladas
-- como evidencia del arqueo.
ALTER TABLE "CashAudit"
ADD COLUMN "guaranteeSnapshot" JSONB;
