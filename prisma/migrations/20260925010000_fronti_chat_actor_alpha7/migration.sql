-- FRONTI deja de fingir ser un usuario humano dentro del chat.
-- Las conversaciones privadas con el agente son un tipo propio y sus mensajes
-- declaran actor explícito. senderId queda nulo para FRONTI/SYSTEM.

ALTER TYPE "ChatConversationType" ADD VALUE IF NOT EXISTS 'FRONTI';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChatMessageAuthor') THEN
    CREATE TYPE "ChatMessageAuthor" AS ENUM ('USER', 'FRONTI', 'SYSTEM');
  END IF;
END $$;

ALTER TABLE "ChatMessage"
  ALTER COLUMN "senderId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "author" "ChatMessageAuthor" NOT NULL DEFAULT 'USER';
