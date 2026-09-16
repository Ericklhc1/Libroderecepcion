-- La identidad de una cuenta es su nombre de usuario, no su correo.
--
-- MOTIVO: en el hotel varias cuentas comparten la casilla de recepción, así
-- que el correo no identifica a nadie. El nombre de usuario (@EHerrera) sí, y
-- ya era único. El inicio de sesión pasa a resolverse por él.
--
-- COMPATIBILIDAD: no se elimina ni se vacía ninguna columna.
--   · User.email CONSERVA sus datos: sólo deja de ser único y gana un índice
--     no único, porque se sigue consultando («¿qué cuentas usan esta casilla?»).
--   · LoginAttempt.email se RENOMBRA a identifier: las filas históricas se
--     conservan intactas: guardan lo que se escribió al intentar entrar, que
--     entonces era un correo y ahora es un usuario.
--
-- REVERSIBLE: volver atrás es renombrar la columna de vuelta y recrear el
-- índice único de User.email, lo que exige que no haya correos repetidos.

-- DropIndex
DROP INDEX "User_email_key";

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- AlterTable: se renombra la columna, no se recrea. Así no se pierde historia.
ALTER TABLE "LoginAttempt" RENAME COLUMN "email" TO "identifier";

-- RenameIndex
ALTER INDEX "LoginAttempt_email_createdAt_idx" RENAME TO "LoginAttempt_identifier_createdAt_idx";
