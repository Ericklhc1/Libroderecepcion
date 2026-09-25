-- FRONTI alpha.7: actor nativo del chat sin usuario humano ficticio.
ALTER TYPE "ChatConversationType" ADD VALUE IF NOT EXISTS 'FRONTI';

CREATE TYPE "ChatMessageAuthor" AS ENUM ('USER', 'FRONTI', 'SYSTEM');

ALTER TABLE "ChatMessage"
  ADD COLUMN "author" "ChatMessageAuthor" NOT NULL DEFAULT 'USER';

ALTER TABLE "ChatMessage"
  ALTER COLUMN "senderId" DROP NOT NULL;
