-- Turnos: dos ventanas fijas, creados a voluntad, uno en curso a la vez.
--
-- POR QUÉ. El modelo anterior tenía tres franjas de ocho horas y una unicidad
-- por (fecha, tipo). De ahí salía la necesidad de «programar» los turnos, y de
-- ahí venía un atasco real: para recibir una entrega el sistema buscaba el
-- turno de la franja ANTERIOR por (fecha, tipo). Si esa fila no existía
-- —porque nadie programó ese turno— no encontraba nada que recibir, y el
-- cierre tampoco podía completarse. En la base había un turno ACTIVO del 14
-- de septiembre y nada en la franja siguiente: la cadena quedaba cortada.
--
-- Los turnos de MAÑANA y TARDE se convierten en DIA. Es el mapeo más fiel:
-- ambos ocurrían dentro de la ventana diurna. Ninguna fila se borra.

-- 1. PRIMERO fuera la unicidad por fecha+tipo.
--    Tiene que ir antes de convertir el enum: `ALTER COLUMN ... TYPE` reconstruye
--    los índices de esa columna, y al fusionar MAÑANA y TARDE en DIA dos turnos
--    del mismo día colisionan. Reconstruirlo falla con
--    «Key (date, type)=(…, DIA) is duplicated» —pasó al aplicarla— así que el
--    orden no es estético.
--
--    Además de un requisito técnico es la regla nueva: puede haber dos turnos
--    de día el mismo día (una cobertura partida, un relevo adelantado).
DROP INDEX IF EXISTS "Shift_date_type_key";

-- 2. Nuevo enum con los dos valores, y conversión de los datos existentes.
CREATE TYPE "ShiftType_new" AS ENUM ('DIA', 'NOCHE');

ALTER TABLE "Shift"
  ALTER COLUMN "type" TYPE "ShiftType_new"
  USING (
    CASE "type"::text
      WHEN 'NOCHE' THEN 'NOCHE'
      ELSE 'DIA'
    END
  )::"ShiftType_new";

DROP TYPE "ShiftType";
ALTER TYPE "ShiftType_new" RENAME TO "ShiftType";

-- 3. La invariante que SÍ se exige: UN SOLO TURNO EN CURSO A LA VEZ.
--    Índice único parcial sobre una expresión constante: a lo sumo una fila
--    puede cumplir el predicado. Prisma no sabe expresar índices parciales, así
--    que vive acá; el servicio también lo comprueba, pero para dar un mensaje
--    legible, no para garantizarlo.
--
--    ENTREGA_ENVIADA queda FUERA del predicado a propósito: un turno que ya
--    envió su cierre espera en la bandeja, y quien lo recibe necesita abrir el
--    suyo. Si bloqueara, el relevo sería imposible.
--
--    Antes de crearlo hay que dejar a lo sumo uno en curso: se cierran los
--    turnos en curso más antiguos, conservando el más reciente. Se registra el
--    motivo en `notes` para que nadie tenga que adivinar de dónde salió.
WITH en_curso AS (
  SELECT "id",
         ROW_NUMBER() OVER (ORDER BY COALESCE("actualStart", "plannedStart") DESC) AS fila
  FROM "Shift"
  WHERE "status" IN ('INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA')
)
UPDATE "Shift" AS s
SET "status" = 'CERRADO',
    "actualEnd" = COALESCE(s."actualEnd", s."plannedEnd"),
    "notes" = COALESCE(s."notes" || ' · ', '') ||
      'Cerrado por la migración a turnos de día/noche: había varios turnos en curso a la vez, que es lo que impedía recibir y cerrar.'
FROM en_curso
WHERE s."id" = en_curso."id" AND en_curso.fila > 1;

CREATE UNIQUE INDEX "Shift_un_solo_turno_en_curso"
  ON "Shift" ((TRUE))
  WHERE "status" IN ('INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA');

-- 4. Las ventanas nominales de los turnos abiertos se realinean a las fijas.
--    Sólo los que todavía no terminaron: la historia de los cerrados se
--    conserva tal como ocurrió.
UPDATE "Shift"
SET "plannedStart" = date_trunc('day', "date") + INTERVAL '7 hours',
    "plannedEnd"   = date_trunc('day', "date") + INTERVAL '20 hours'
WHERE "type" = 'DIA'
  AND "status" IN ('PROGRAMADO', 'INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA', 'ENTREGA_ENVIADA');

UPDATE "Shift"
SET "plannedStart" = date_trunc('day', "date") + INTERVAL '20 hours',
    "plannedEnd"   = date_trunc('day', "date") + INTERVAL '32 hours'
WHERE "type" = 'NOCHE'
  AND "status" IN ('PROGRAMADO', 'INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA', 'ENTREGA_ENVIADA');
