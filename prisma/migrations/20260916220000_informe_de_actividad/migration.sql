-- «Habitaciones con actividad»: el informe principal de FNS.
--
-- Todo lo de acá es ADITIVO. No se borra ni se renombra nada, y los tres
-- informes antiguos —entradas, salidas, in house— siguen funcionando igual:
-- pasan a ser secundarios, no desaparecen.

-- El nuevo tipo de informe. En Postgres agregar un valor a un enum es seguro
-- dentro de una transacción mientras no se use en la misma transacción.
ALTER TYPE "PmsReportKind" ADD VALUE IF NOT EXISTS 'ACTIVIDAD';

-- Huéspedes e importes DE LA ESTANCIA.
--
-- Viven en la estancia y no en la habitación, y no es un detalle: en el
-- informe real una misma reserva ocupa ocho habitaciones con saldos distintos
-- —CL$ 0 en cuatro y CL$ 15.000 en una— y una habitación puede tener el mismo
-- día una salida con saldo cero y una entrada con saldo pendiente. Un «saldo
-- de habitación» sería falso en los dos casos.
--
-- La moneda va aparte y nunca se mezcla: el informe trae pesos y dólares a la
-- vez, y en cada moneda el punto significa otra cosa.
ALTER TABLE "RoomStay" ADD COLUMN "guestCount" INTEGER;
ALTER TABLE "RoomStay" ADD COLUMN "totalAmount" DECIMAL(12,2);
ALTER TABLE "RoomStay" ADD COLUMN "pendingAmount" DECIMAL(12,2);
ALTER TABLE "RoomStay" ADD COLUMN "currency" VARCHAR(3);

-- Forma de pago normalizada Y su texto original. De esto depende si el mesón
-- cobra —marcar un prepago como cobrable es cobrarle dos veces al huésped— y
-- el PMS puede introducir formas nuevas, así que se guardan las dos.
ALTER TABLE "RoomStay" ADD COLUMN "paymentType" TEXT;
ALTER TABLE "RoomStay" ADD COLUMN "paymentTypeRaw" TEXT;
