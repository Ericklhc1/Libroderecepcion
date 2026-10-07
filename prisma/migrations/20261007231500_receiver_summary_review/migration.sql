-- Additive review fingerprints on the existing handover. No backfill or history writes.
ALTER TABLE "ShiftHandover" ADD COLUMN "receiverBriefingSummaryKey" TEXT, ADD COLUMN "receiverFinalSummaryKey" TEXT;
