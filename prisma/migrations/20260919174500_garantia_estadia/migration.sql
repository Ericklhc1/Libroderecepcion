-- La garantía sigue colgada de la reserva, pero conserva la estadía exacta
-- cuando puede resolverse. Así un cambio de habitación no pierde contexto.
ALTER TABLE "Guarantee"
  ADD COLUMN "stayId" TEXT;

CREATE INDEX "Guarantee_stayId_idx" ON "Guarantee"("stayId");

ALTER TABLE "Guarantee"
  ADD CONSTRAINT "Guarantee_stayId_fkey"
  FOREIGN KEY ("stayId") REFERENCES "RoomStay"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill conservador: sólo asigna estadía cuando la reserva tiene exactamente
-- una estadía activa. Si hay varias, deja NULL en vez de adivinar.
WITH unique_active_stay AS (
  SELECT rs."reservationRefId", MIN(rs."id") AS "stayId"
  FROM "RoomStay" rs
  WHERE rs."deletedAt" IS NULL
    AND rs."stage" IN ('PENDIENTE', 'CONFIRMADO')
    AND rs."reservationRefId" IS NOT NULL
  GROUP BY rs."reservationRefId"
  HAVING COUNT(*) = 1
)
UPDATE "Guarantee" g
SET "stayId" = u."stayId"
FROM unique_active_stay u
WHERE g."reservationReferenceId" = u."reservationRefId"
  AND g."stayId" IS NULL;
