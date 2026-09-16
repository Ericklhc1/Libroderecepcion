-- Una cuenta es nombre, usuario y contraseña. Se elimina `User.email`.
--
-- POR QUÉ. El correo dejó de ser identificador en
-- `20260916040000_identidad_por_usuario`: en el hotel todo el mesón comparte la
-- casilla de recepción, así que no distinguía a nadie y no servía para entrar.
-- Lo que quedaba era un campo obligatorio que alguien tenía que inventar al
-- crear cada cuenta, y que no se usaba para nada.
--
-- La casilla a la que se envían las credenciales de un usuario nuevo es del
-- HOTEL, no de la persona, y vive en la configuración de correo
-- (`MailSettings.credentialsMailTo`). Eliminar esta columna no afecta ese
-- envío.
--
-- `GuestReference.email` NO se toca: ése es el correo del huésped, es un dato
-- real del hotel y sí se usa.
--
-- IRREVERSIBLE en cuanto a datos: los correos de las cuentas se pierden. Es
-- deliberado y acordado; no había ninguno que el sistema usara.

DROP INDEX IF EXISTS "User_email_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "email";
