ALTER TABLE "ChatMessage"
  ADD COLUMN "stickerId" TEXT;

CREATE TABLE "ChatReaction" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatReaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatSavedMessage" (
  "userId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatSavedMessage_pkey" PRIMARY KEY ("userId","messageId")
);

CREATE TABLE "ChatTyping" (
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatTyping_pkey" PRIMARY KEY ("conversationId","userId")
);

CREATE TABLE "ChatSticker" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ChatSticker_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMediaPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "refKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMediaPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatReaction_messageId_userId_emoji_key"
  ON "ChatReaction"("messageId","userId","emoji");
CREATE INDEX "ChatReaction_messageId_idx" ON "ChatReaction"("messageId");
CREATE INDEX "ChatReaction_userId_idx" ON "ChatReaction"("userId");
CREATE INDEX "ChatSavedMessage_messageId_idx" ON "ChatSavedMessage"("messageId");
CREATE INDEX "ChatTyping_conversationId_updatedAt_idx" ON "ChatTyping"("conversationId","updatedAt");
CREATE INDEX "ChatTyping_userId_idx" ON "ChatTyping"("userId");
CREATE INDEX "ChatSticker_ownerId_createdAt_idx" ON "ChatSticker"("ownerId","createdAt");
CREATE INDEX "ChatSticker_deletedAt_idx" ON "ChatSticker"("deletedAt");
CREATE UNIQUE INDEX "ChatMediaPreference_userId_kind_refKey_key"
  ON "ChatMediaPreference"("userId","kind","refKey");
CREATE INDEX "ChatMediaPreference_userId_kind_favorite_idx"
  ON "ChatMediaPreference"("userId","kind","favorite");
CREATE INDEX "ChatMediaPreference_userId_kind_usedAt_idx"
  ON "ChatMediaPreference"("userId","kind","usedAt");
CREATE INDEX "ChatMessage_stickerId_idx" ON "ChatMessage"("stickerId");

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_stickerId_fkey"
  FOREIGN KEY ("stickerId") REFERENCES "ChatSticker"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatReaction"
  ADD CONSTRAINT "ChatReaction_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatReaction"
  ADD CONSTRAINT "ChatReaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatSavedMessage"
  ADD CONSTRAINT "ChatSavedMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatSavedMessage"
  ADD CONSTRAINT "ChatSavedMessage_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatTyping"
  ADD CONSTRAINT "ChatTyping_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatTyping"
  ADD CONSTRAINT "ChatTyping_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatSticker"
  ADD CONSTRAINT "ChatSticker_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMediaPreference"
  ADD CONSTRAINT "ChatMediaPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;