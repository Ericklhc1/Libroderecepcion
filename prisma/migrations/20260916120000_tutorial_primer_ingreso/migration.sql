-- Recorrido guiado del primer ingreso.
--
-- Se guarda en el usuario y no en el navegador a propósito: quien entra desde
-- otro equipo el primer día sigue siendo alguien que ya conoce el sistema.
--
-- COMPATIBILIDAD: aditiva y nullable. Las cuentas existentes quedan con NULL,
-- o sea «todavía no lo hizo», así que a todo el personal actual se le ofrecerá
-- el recorrido una vez. Es el comportamiento que se quiere: nadie lo ha visto.
--
-- REVERSIBLE: eliminar la columna.

ALTER TABLE "User" ADD COLUMN "tutorialDoneAt" TIMESTAMP(3);
