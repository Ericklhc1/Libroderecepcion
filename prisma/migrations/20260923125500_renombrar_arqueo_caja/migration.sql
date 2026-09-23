-- Ajuste semántico no destructivo: la operación se denomina "arqueo".
UPDATE "Permission"
SET "name" = 'Arquear efectivo'
WHERE "key" = 'cash.audit';
