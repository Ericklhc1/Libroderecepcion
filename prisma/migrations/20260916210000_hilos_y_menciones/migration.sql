-- Hilos de conversación y menciones.
--
-- Dos cambios pequeños con un efecto grande en el mesón.
--
-- 1) `Comment.parentId`: un comentario puede responder a otro, y con eso una
--    novedad larga deja de ser una lista plana donde no se sabe qué contesta
--    a qué. La respuesta se borra en cascada con su comentario padre: si el
--    comentario original se va, sus respuestas pierden todo sentido.
--
--    Es deliberadamente UN solo nivel a nivel de producto —se responde a un
--    comentario, no a una respuesta— pero la columna no lo impide, y la regla
--    vive en el servicio. Así, si mañana hace falta más profundidad, no hay
--    que migrar la base otra vez.
--
-- 2) `NotificationType.MENCION`: mencionar a alguien con «@» no es lo mismo
--    que comentar. El comentario avisa a los interesados del registro; la
--    mención avisa a quien se nombró, que puede no tener nada que ver con él.
--    Separarlos permite que la persona distinga «pasó algo en lo mío» de «me
--    están pidiendo algo a mí».

ALTER TABLE "Comment" ADD COLUMN "parentId" TEXT;

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Comment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MENCION';
