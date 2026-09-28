-- Recepción guiada del relevo.
-- El entrante inicia un turno en estado INICIADO y completa estas barreras
-- dentro del módulo Turno antes de activar la operación.

ALTER TABLE "ShiftHandover"
  ADD COLUMN "receiverBriefingReviewedAt" TIMESTAMP(3),
  ADD COLUMN "receiverCustodyReviewedAt" TIMESTAMP(3),
  ADD COLUMN "receiverFinalReviewAt" TIMESTAMP(3),
  ADD COLUMN "receiverUrgentAcknowledgedAt" TIMESTAMP(3);


-- Ciclo de vida del turno de emergencia: sólo puede existir uno operativo
-- sin resolver. Al cerrarse el turno que originó la excepción, la emergencia
-- se libera y el turno vigente continúa como normal.
ALTER TABLE "Shift"
  ADD COLUMN "emergencyResolvedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Shift_una_emergencia_operativa_activa"
  ON "Shift" ((1))
  WHERE "emergency" = TRUE
    AND "emergencyResolvedAt" IS NULL
    AND "status" NOT IN ('CERRADO', 'ANULADO');
