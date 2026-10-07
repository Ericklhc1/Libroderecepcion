-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "closureReviewDecision" TEXT,
ADD COLUMN     "closureReviewNote" TEXT,
ADD COLUMN     "closureReviewRequestedAt" TIMESTAMP(3),
ADD COLUMN     "closureReviewedAt" TIMESTAMP(3),
ADD COLUMN     "closureReviewedById" TEXT;

-- AlterTable
ALTER TABLE "OperationalEntry" ADD COLUMN     "includeInReceptionHandover" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "_EntryHiddenAreas" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EntryHiddenAreas_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_EntryHiddenAreas_B_index" ON "_EntryHiddenAreas"("B");

-- AddForeignKey
ALTER TABLE "_EntryHiddenAreas" ADD CONSTRAINT "_EntryHiddenAreas_A_fkey" FOREIGN KEY ("A") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EntryHiddenAreas" ADD CONSTRAINT "_EntryHiddenAreas_B_fkey" FOREIGN KEY ("B") REFERENCES "OperationalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Única sustitución autorizada: conservar el trigger y registrar la acción en
-- el mismo Shift que proyecta el Centro. Sin nuevas alertas, tareas o novedades.
-- Los cierres/alertas históricos no se reescriben.
CREATE OR REPLACE FUNCTION "create_shift_closure_validation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'CERRADO'::"ShiftStatus"
     AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    UPDATE "Shift" SET "closureReviewRequestedAt" = CURRENT_TIMESTAMP,
      "closureReviewDecision" = NULL, "closureReviewedAt" = NULL,
      "closureReviewedById" = NULL, "closureReviewNote" = NULL
    WHERE "id" = NEW."id";
    INSERT INTO "AuditLog" (
      "id", "entity", "entityId", "action", "summary", "userId", "after", "isDemo"
    ) VALUES (
      gen_random_uuid()::text, 'Shift', NEW."id", 'CREAR'::"AuditAction",
      'Acción pendiente en Centro de Supervisión: validar cierre de turno',
      NEW."closedById", jsonb_build_object('closureReviewRequestedAt', CURRENT_TIMESTAMP), NEW."isDemo"
    );
  END IF;
  RETURN NEW;
END;
$$;
