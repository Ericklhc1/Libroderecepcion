-- Recepción guiada del relevo.
-- El entrante inicia un turno en estado INICIADO y completa estas barreras
-- dentro del módulo Turno antes de activar la operación.

ALTER TABLE "ShiftHandover"
  ADD COLUMN "receiverBriefingReviewedAt" TIMESTAMP(3),
  ADD COLUMN "receiverCustodyReviewedAt" TIMESTAMP(3),
  ADD COLUMN "receiverFinalReviewAt" TIMESTAMP(3),
  ADD COLUMN "receiverUrgentAcknowledgedAt" TIMESTAMP(3);
