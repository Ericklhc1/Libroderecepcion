-- Existing novelties remain general; only new internal reception records opt in.
ALTER TABLE "OperationalEntry" ADD COLUMN "receptionInternal" BOOLEAN NOT NULL DEFAULT false;
