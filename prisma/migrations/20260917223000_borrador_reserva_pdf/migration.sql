CREATE TABLE IF NOT EXISTS "ReservationPdfDraft" (
  "id" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "extracted" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  "discardedAt" TIMESTAMP(3),
  CONSTRAINT "ReservationPdfDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReservationPdfDraft_createdAt_idx"
  ON "ReservationPdfDraft"("createdAt");

DO $$ BEGIN
  ALTER TABLE "ReservationPdfDraft"
    ADD CONSTRAINT "ReservationPdfDraft_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;