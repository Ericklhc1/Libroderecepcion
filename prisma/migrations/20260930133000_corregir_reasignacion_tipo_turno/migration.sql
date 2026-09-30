-- Corrige el significado del permiso creado en 1.37.3.
--
-- La intención funcional es cambiar el TIPO del turno operativo (DÍA/NOCHE),
-- no cambiar a la persona titular. Se conserva la misma clave para no perder
-- configuraciones de roles ya realizadas entre despliegues.

UPDATE "Permission"
SET "name" = 'Cambiar tipo de turno Día/Noche',
    "group" = 'Turnos'
WHERE "key" = 'shift.reassign';
