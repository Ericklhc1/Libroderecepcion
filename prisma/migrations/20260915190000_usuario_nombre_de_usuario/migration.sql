-- Nombre de usuario corto y único por persona (del estilo EHerrera).
--
-- Se agrega en tres pasos para no romper las cuentas que ya existen: primero
-- la columna acepta nulos, luego se rellena a partir del nombre, y sólo
-- entonces se vuelve obligatoria y única.

ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Inicial del nombre más el primer apellido, sin espacios ni signos.
UPDATE "User"
SET "username" = regexp_replace(
  upper(left(split_part("name", ' ', 1), 1))
    || initcap(coalesce(nullif(split_part("name", ' ', 2), ''), substr(split_part("name", ' ', 1), 2))),
  '[^A-Za-z0-9._-]', '', 'g'
);

-- Si quedó vacío (nombres con caracteres no latinos), usa un valor seguro.
UPDATE "User" SET "username" = 'Usuario' WHERE "username" IS NULL OR length("username") < 3;

-- Desambigua los repetidos: el segundo pasa a ser EHerrera2, el tercero EHerrera3.
WITH numbered AS (
  SELECT "id",
         "username",
         row_number() OVER (PARTITION BY "username" ORDER BY "createdAt", "id") AS position
  FROM "User"
)
UPDATE "User" AS u
SET "username" = u."username" || numbered.position::text
FROM numbered
WHERE numbered."id" = u."id" AND numbered.position > 1;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
