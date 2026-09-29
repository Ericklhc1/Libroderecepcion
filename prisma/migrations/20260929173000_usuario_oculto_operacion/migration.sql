-- Permite cuentas plenamente activas que no deben aparecer en selectores
-- ni directorios operativos. No altera permisos, sesiones ni historial.

ALTER TABLE "User"
  ADD COLUMN "hiddenFromSelectors" BOOLEAN NOT NULL DEFAULT false;
