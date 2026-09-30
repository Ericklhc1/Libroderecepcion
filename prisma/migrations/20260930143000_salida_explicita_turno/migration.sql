-- Diferencia una salida manual de una finalización técnica de participación.
--
-- `leftAt` ya registra cuándo termina la participación, pero también se usa
-- cuando un turno se cierra o una emergencia libera al saliente. Este flag
-- permite conservar esa trazabilidad histórica sin que una persona retirada
-- manualmente mantenga privilegios operativos sobre el turno.

ALTER TABLE "ShiftAssignment"
ADD COLUMN "removedExplicitly" BOOLEAN NOT NULL DEFAULT false;
