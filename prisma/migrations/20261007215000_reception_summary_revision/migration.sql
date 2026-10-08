-- Additive freshness metadata on the existing handover engine. No historical
-- snapshots, items, alerts, audit records or previous migrations are rewritten.
ALTER TABLE "ShiftHandover" ADD COLUMN "receptionSummaryRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "receptionSummaryPreparedRevision" INTEGER NOT NULL DEFAULT 0;
