CREATE TABLE "AssistantActionReceipt" (
  "id" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantActionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantActionReceipt_nonce_key"
  ON "AssistantActionReceipt"("nonce");

CREATE INDEX "AssistantActionReceipt_userId_createdAt_idx"
  ON "AssistantActionReceipt"("userId", "createdAt");

ALTER TABLE "AssistantActionReceipt"
  ADD CONSTRAINT "AssistantActionReceipt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
