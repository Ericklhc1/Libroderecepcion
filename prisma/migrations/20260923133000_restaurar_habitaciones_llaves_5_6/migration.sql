-- Inventario canónico de habitaciones para Llaves.
-- No elimina datos ni reinicia operación. Agrega/reactiva únicamente los pisos 5 y 6
-- y asegura la existencia de una llave principal por habitación cuando falte.

WITH expected_rooms AS (
  SELECT gs::text AS number, 5 AS floor FROM generate_series(501, 530) AS gs
  UNION ALL
  SELECT gs::text AS number, 6 AS floor FROM generate_series(601, 630) AS gs
)
INSERT INTO "Room" ("id", "number", "floor", "active", "createdAt", "updatedAt")
SELECT
  'canonical-room-' || number,
  number,
  floor,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM expected_rooms
ON CONFLICT ("number") DO UPDATE
SET
  "floor" = EXCLUDED."floor",
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "RoomKey" ("id", "code", "type", "status", "roomId", "createdAt", "updatedAt")
SELECT
  'canonical-key-P-' || r."number",
  'P-' || r."number",
  'PRINCIPAL',
  'DISPONIBLE',
  r."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Room" AS r
WHERE
  (r."number"::int BETWEEN 501 AND 530 OR r."number"::int BETWEEN 601 AND 630)
ON CONFLICT ("code") DO NOTHING;

UPDATE "RoomKey" AS k
SET
  "roomId" = r."id",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Room" AS r
WHERE
  k."roomId" IS NULL
  AND k."code" = 'P-' || r."number"
  AND (r."number"::int BETWEEN 501 AND 530 OR r."number"::int BETWEEN 601 AND 630);
