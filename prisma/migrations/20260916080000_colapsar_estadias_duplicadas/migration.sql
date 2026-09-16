-- Colapsa las estadías duplicadas que dejó la clave anterior.
--
-- CONTEXTO: hasta la corrección de `applyImport`, la clave de deduplicación
-- incluía el estado completo, así que la misma reserva en el informe de in
-- house y en el de entradas generaba DOS filas. En producción quedaron nueve
-- habitaciones así, todas con el mismo patrón CHECK_IN + IN_HOUSE, mostrando
-- al mismo huésped como «Actual» y «Entrante» a la vez.
--
-- El código ya no las crea. Esta migración limpia las que existen.
--
-- QUÉ SE ELIMINA: sólo la fila CHECK_IN cuando existe otra fila IN_HOUSE de la
-- MISMA reserva y la MISMA habitación. La CHECK_IN es la redundante: el
-- huésped ya está dentro, así que no está «por llegar».
--
-- NADA SE BORRA DE VERDAD: eliminación LÓGICA con motivo, como el resto del
-- sistema. `deletedById` queda nulo porque no la elimina una persona sino esta
-- reparación, y el motivo lo dice. Quedan restaurables.
--
-- NO TOCA: ninguna fila intervenida a mano (`touchedManually`), ninguna que ya
-- esté eliminada, y ninguna habitación sin el duplicado. Si alguien confirmó
-- el check-in a mano, esa fila se conserva y el conflicto se resuelve con el
-- botón «Eliminar estadía» de la ficha, que sí queda auditado.
--
-- REVERSIBLE: poner `deletedAt` y `deletionReason` en NULL en las filas cuyo
-- motivo es el de esta migración.

WITH duplicadas AS (
  SELECT entrada."id"
  FROM "RoomStay" AS entrada
  JOIN "RoomStay" AS dentro
    ON dentro."roomId" = entrada."roomId"
   AND dentro."reservationId" = entrada."reservationId"
   AND dentro."status" = 'IN_HOUSE'
   AND dentro."deletedAt" IS NULL
   AND dentro."id" <> entrada."id"
  WHERE entrada."status" = 'CHECK_IN'
    AND entrada."deletedAt" IS NULL
    AND entrada."touchedManually" = false
)
UPDATE "RoomStay" AS s
SET "deletedAt" = NOW(),
    "deletionReason" =
      'Estadía duplicada por la clave de importación anterior: la misma reserva '
      || 'llegó en el informe de in house y en el de entradas. Colapsada por la '
      || 'migración 20260916080000.'
FROM duplicadas AS d
WHERE s."id" = d."id";

-- Una llave que apuntara a la fila eliminada volvería al inventario. En
-- producción no hay ninguna, pero dejarla apuntando a una estadía eliminada
-- sería exactamente el conflicto que todo esto viene a resolver.
UPDATE "RoomKey" AS k
SET "stayId" = NULL,
    "status" = 'DISPONIBLE'
FROM "RoomStay" AS s
WHERE k."stayId" = s."id"
  AND s."deletedAt" IS NOT NULL;
