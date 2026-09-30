CREATE TABLE "FrontiProactiveClaim" (
  "signalId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FrontiProactiveClaim_pkey" PRIMARY KEY ("signalId", "userId")
);

CREATE INDEX "FrontiProactiveClaim_claimedAt_idx"
ON "FrontiProactiveClaim"("claimedAt");

-- Conserva el cooldown observado antes del despliegue para no repetir avisos
-- recientes en la primera ejecución de v1.33.1.
INSERT INTO "FrontiProactiveClaim" ("signalId", "userId", "claimedAt")
SELECT
  "entityId" AS "signalId",
  "userId",
  MAX("createdAt") AS "claimedAt"
FROM "Notification"
WHERE
  "type" = 'FRONTI_HALLAZGO'
  AND "entity" = 'FrontiProactiveSignal'
  AND "entityId" IS NOT NULL
GROUP BY "entityId", "userId"
ON CONFLICT ("signalId", "userId") DO UPDATE
SET "claimedAt" = GREATEST(
  "FrontiProactiveClaim"."claimedAt",
  EXCLUDED."claimedAt"
);
