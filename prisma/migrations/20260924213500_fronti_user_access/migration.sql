-- Fronti: acceso controlado por usuario.
-- El Administrador de sistema se mantiene siempre habilitado por lógica de aplicación.
ALTER TABLE "User"
ADD COLUMN "frontiAccessEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Habilitación inicial solicitada para @eherrera.
UPDATE "User"
SET "frontiAccessEnabled" = true
WHERE LOWER("username") = 'eherrera';
