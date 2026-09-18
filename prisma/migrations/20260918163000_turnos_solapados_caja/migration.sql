-- Turnos solapados + participación activa exclusiva por persona.
--
-- QUÉ CAMBIA. Hasta ahora el hotel admitía un solo turno en curso: el índice
-- `Shift_un_solo_turno_en_curso` lo garantizaba con una unicidad de UNA FILA
-- para toda la tabla. El recepcionista entrante tenía que esperar el cierre
-- completo del saliente, y eso era el atasco.
--
-- QUÉ GARANTÍA LO REEMPLAZA. Los turnos ahora se solapan a propósito. Lo que
-- no puede repetirse es una PERSONA: nadie participa activamente en dos turnos
-- a la vez, sea TITULAR o APOYO. Se representa explícitamente en
-- `ShiftAssignment` con `activatedAt` / `leftAt`, y lo impide PostgreSQL con un
-- índice único parcial, no el código de aplicación.
--
-- NO BORRA HISTORIAL. Ninguna fila se elimina. Las asignaciones históricas
-- quedan con sus dos marcas de tiempo derivadas del turno al que pertenecen.

-- 1. Participación explícita.
ALTER TABLE "ShiftAssignment" ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);
ALTER TABLE "ShiftAssignment" ADD COLUMN IF NOT EXISTS "leftAt"      TIMESTAMP(3);

-- 2. Backfill. La participación se deriva del estado del turno.
--
--    PROGRAMADO                → activatedAt NULL: nombre puesto, nadie en el
--                                mesón todavía. No bloquea a esa persona.
--    en curso                  → activa: activatedAt puesto, leftAt NULL.
--    ENTREGA_ENVIADA y en más  → terminada: la persona ya salió del mesón.
--
--    ENTREGA_ENVIADA cuenta como SALIDA, no como participación activa. Dos
--    razones. Operativa: quien envió su entrega ya dejó el mesón y sólo le
--    queda cerrar, que ahora puede hacer solo. Y de seguridad del backfill: el
--    índice viejo NO cubría ENTREGA_ENVIADA, así que en los datos actuales sí
--    puede haber alguien que entregó y además se sumó al turno siguiente.
--    Tratarlo como activo haría fallar la creación del índice; tratarlo como
--    salida hace el backfill seguro por construcción, porque el índice viejo
--    garantizaba a lo sumo un turno en los tres estados restantes.
UPDATE "ShiftAssignment" AS sa
SET "activatedAt" = CASE
      WHEN s."status" = 'PROGRAMADO' THEN NULL
      ELSE COALESCE(s."actualStart", s."createdAt", sa."createdAt")
    END,
    "leftAt" = CASE
      WHEN s."status" IN ('PROGRAMADO', 'INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA') THEN NULL
      ELSE COALESCE(s."actualEnd", s."updatedAt", sa."createdAt")
    END
FROM "Shift" AS s
WHERE sa."shiftId" = s."id";

-- 3. Red de seguridad. Si por cualquier motivo quedara más de una
--    participación activa para una misma persona, se conserva la más reciente
--    y las anteriores se cierran con la marca de fin de su propio turno. No se
--    borra ninguna fila: sólo se les pone `leftAt`.
WITH activas AS (
  SELECT sa."id",
         ROW_NUMBER() OVER (
           PARTITION BY sa."userId"
           ORDER BY sa."activatedAt" DESC NULLS LAST, sa."createdAt" DESC
         ) AS fila,
         COALESCE(s."actualEnd", s."updatedAt", sa."createdAt") AS fin
  FROM "ShiftAssignment" sa
  JOIN "Shift" s ON s."id" = sa."shiftId"
  WHERE sa."activatedAt" IS NOT NULL AND sa."leftAt" IS NULL
)
UPDATE "ShiftAssignment" AS sa
SET "leftAt" = activas."fin"
FROM activas
WHERE sa."id" = activas."id" AND activas."fila" > 1;

-- 4. Fuera la unicidad global por hotel.
DROP INDEX IF EXISTS "Shift_un_solo_turno_en_curso";

-- 5. Y en su lugar, la exclusividad por persona. Cubre TITULAR y APOYO por
--    igual, porque mira `userId` y no el rol.
CREATE UNIQUE INDEX IF NOT EXISTS "ShiftAssignment_participacion_activa_por_usuario"
  ON "ShiftAssignment" ("userId")
  WHERE "activatedAt" IS NOT NULL AND "leftAt" IS NULL;

-- 6. Índice de apoyo para las consultas «¿en qué participo ahora?».
CREATE INDEX IF NOT EXISTS "ShiftAssignment_userId_leftAt_idx"
  ON "ShiftAssignment" ("userId", "leftAt");
