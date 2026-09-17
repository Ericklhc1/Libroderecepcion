-- Cantidad de unidades afectadas por una misma multa.
-- Aditivo: las multas existentes representan una unidad.
ALTER TABLE "Fine"
ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Fine"
ADD CONSTRAINT "Fine_quantity_check" CHECK ("quantity" > 0);
