-- Memoria del Asistente de Recepción.
-- Se mantiene separada de los objetos operativos: nunca sustituye tareas,
-- garantías, multas, novedades ni auditoría.

CREATE TABLE "ai_conversation" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "shift_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "closed_at" TIMESTAMPTZ
);

CREATE TABLE "ai_message" (
  "id" TEXT PRIMARY KEY,
  "conversation_id" TEXT NOT NULL REFERENCES "ai_conversation"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ NOT NULL
);

CREATE TABLE "ai_memory" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "conversation_id" TEXT REFERENCES "ai_conversation"("id") ON DELETE CASCADE,
  "shift_id" TEXT,
  "scope" TEXT NOT NULL CHECK ("scope" IN ('PERSONAL', 'TURNO')),
  "summary" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "importance" INTEGER NOT NULL DEFAULT 3 CHECK ("importance" BETWEEN 1 AND 5),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX "ai_conversation_one_active_per_session"
  ON "ai_conversation" ("user_id", "session_id")
  WHERE "closed_at" IS NULL;

CREATE INDEX "ai_conversation_user_session_active"
  ON "ai_conversation" ("user_id", "session_id", "last_active_at" DESC);

CREATE INDEX "ai_conversation_expires_at"
  ON "ai_conversation" ("expires_at");

CREATE INDEX "ai_message_conversation_created_at"
  ON "ai_message" ("conversation_id", "created_at" DESC);

CREATE INDEX "ai_message_expires_at"
  ON "ai_message" ("expires_at");

CREATE INDEX "ai_memory_user_scope_updated"
  ON "ai_memory" ("user_id", "scope", "updated_at" DESC);

CREATE INDEX "ai_memory_shift"
  ON "ai_memory" ("shift_id", "updated_at" DESC);

CREATE INDEX "ai_memory_expires_at"
  ON "ai_memory" ("expires_at");
