-- El flujo vigente no programa turnos: los abre cada persona al comenzar y
-- Supervisión administra participación, trazabilidad y archivo.
UPDATE "Permission"
SET "name" = 'Supervisar y administrar turnos'
WHERE "key" = 'shift.manage';
