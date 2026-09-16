-- Turnos archivables.
--
-- MOTIVO: archivar no es anular. Anular dice «este turno no se va a usar» y
-- sólo vale antes de que empiece; archivar dice «ya pasó y no quiero verlo en
-- las listas», y vale para los que terminaron. Un turno archivado conserva su
-- historia, sus registros y su entrega: deja de ofrecerse y de listarse.
--
-- COMPATIBILIDAD: puramente ADITIVA. Dos columnas nullable y un índice. Las
-- filas existentes quedan con archivedAt NULL, o sea sin archivar, que es
-- exactamente el comportamiento anterior.
--
-- La duración libre del turno NO necesita migración: plannedStart y
-- plannedEnd ya existían y admiten cualquier ventana. El límite de doce horas
-- lo impone `customWindow` en el dominio.
--
-- REVERSIBLE: eliminar las dos columnas y el índice.

ALTER TABLE "Shift" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Shift" ADD COLUMN "archivedById" TEXT;

CREATE INDEX "Shift_archivedAt_idx" ON "Shift"("archivedAt");

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_archivedById_fkey"
  FOREIGN KEY ("archivedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
