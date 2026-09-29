-- Web Push: una suscripción por navegador/dispositivo.
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "lastTriggeredAt" TIMESTAMP(3),
    "lastDeliveredAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key"
ON "PushSubscription"("endpoint");

CREATE INDEX "PushSubscription_userId_disabledAt_idx"
ON "PushSubscription"("userId", "disabledAt");

CREATE INDEX "PushSubscription_disabledAt_lastTriggeredAt_idx"
ON "PushSubscription"("disabledAt", "lastTriggeredAt");

ALTER TABLE "PushSubscription"
ADD CONSTRAINT "PushSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
