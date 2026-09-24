ALTER TYPE "ChatMessageKind" ADD VALUE IF NOT EXISTS 'GIF';

ALTER TABLE "User"
  ADD COLUMN "chatAvatarKey" TEXT NOT NULL DEFAULT 'dragon',
  ADD COLUMN "chatStatusText" TEXT,
  ADD COLUMN "chatNotificationTone" TEXT NOT NULL DEFAULT 'chime',
  ADD COLUMN "chatSoundEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ChatMessage"
  ADD COLUMN "mediaUrl" TEXT,
  ADD COLUMN "mediaPageUrl" TEXT,
  ADD COLUMN "mediaSource" TEXT,
  ADD COLUMN "mediaAlt" TEXT;
