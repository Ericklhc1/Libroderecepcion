-- Separar el identificador principal del localizador secundario del PMS.
ALTER TABLE "RoomStay" ADD COLUMN "externalId" TEXT;
CREATE INDEX "RoomStay_externalId_idx" ON "RoomStay"("externalId");

-- La restricción anterior incluía el estado y permitía que CHECK_IN,
-- IN_HOUSE y CHECK_OUT compitieran como realidades operativas distintas.
ALTER TABLE "RoomStay"
  DROP CONSTRAINT IF EXISTS "RoomStay_businessDate_reservationId_roomId_status_key";

-- Normalización comprobada contra Production el 21/09/2026.
-- La evidencia original permanece intacta en PmsImportBatch.payload y cada
-- fila retirada conserva eliminación lógica y AuditLog.
CREATE TEMP TABLE "_PmsStayRepair" (
  "canonicalId" TEXT PRIMARY KEY,
  "historicalId" TEXT NOT NULL,
  "malformedId" TEXT,
  "externalId" TEXT
) ON COMMIT DROP;

INSERT INTO "_PmsStayRepair" ("canonicalId", "historicalId", "malformedId", "externalId") VALUES
  ('cmuagg5fi0000lb04m154fcd7', 'cmu8y5opv000zjt040c04jgln', 'cmuagnv780002jr04qubgpd52', '2539932938'),
  ('cmuagg5fi0005lb04tidr7wox', 'cmu8y5opu0004jt04m3ohbtay', 'cmuagnv780003jr04g4bi9gal', '6616300632'),
  ('cmuagg5fi000clb04x19fk008', 'cmu9nv8mc0002jv04q9ry3kbg', 'cmuagnv780004jr0496gf349f', '6936294180'),
  ('cmuagg5fi0006lb04d63kqvhf', 'cmu9nv8mc0003jv04isohspjh', 'cmuagnv780005jr04ly9weu4o', '6589378654'),
  ('cmuagg5fi000blb04bve6ixya', 'cmu9nv8mc0004jv04wk5j2nrz', 'cmuagnv790006jr041w57g6us', '5454503037'),
  ('cmuagg5fi0007lb04dzb2gw8h', 'cmu9nv8mc0005jv049kfpa16a', 'cmuagnv790007jr0472nv1y2p', '6853936470'),
  ('cmuagg5fi0009lb04zdey7wcu', 'cmu8y5opv0012jt04ek1sskmd', 'cmuagnv790008jr04kajvp67l', '2562886254'),
  ('cmuagg5fi0002lb04t9h62n1h', 'cmu8y5opu000ajt04ipcfgzh8', 'cmuagnv790009jr04f3piwn3b', '2552596378'),
  ('cmuagg5fi0001lb04rpwt2jl6', 'cmu8y5opu000bjt045lv1bnju', 'cmuagnv79000ajr04ar6p2t5l', '2552593159'),
  ('cmuagg5fi0008lb04pxk8alqz', 'cmu9nv8mc0006jv04o3840hlw', NULL, '1789850333');

UPDATE "RoomStay" AS canonical
SET "externalId" = repair."externalId"
FROM "_PmsStayRepair" AS repair
WHERE canonical.id = repair."canonicalId"
  AND repair."externalId" IS NOT NULL
  AND canonical."deletedAt" IS NULL;

INSERT INTO "AuditLog" (
  id, entity, "entityId", action, summary, before, after, reason, "createdAt", "isDemo"
)
SELECT
  'pms-conciliation-v116-' || stay.id,
  'RoomStay',
  stay.id,
  'ELIMINAR'::"AuditAction",
  'Estadía histórica retirada del estado vigente por conciliación PMS',
  jsonb_build_object(
    'reservationId', stay."reservationId",
    'roomId', stay."roomId",
    'status', stay.status,
    'stage', stay.stage,
    'businessDate', stay."businessDate",
    'batchId', stay."batchId"
  ),
  jsonb_build_object('deletedAt', CURRENT_TIMESTAMP),
  CASE
    WHEN stay.id IN (SELECT "historicalId" FROM "_PmsStayRepair")
      THEN 'Transición IN_HOUSE → CHECK_OUT conciliada en una única RoomStay; evidencia preservada en PmsImportBatch.'
    ELSE 'Fila creada por concatenación incorrecta de ID de reserva + Localizador; evidencia preservada en PmsImportBatch.'
  END,
  CURRENT_TIMESTAMP,
  false
FROM "RoomStay" stay
WHERE stay."deletedAt" IS NULL
  AND (
    stay.id IN (SELECT "historicalId" FROM "_PmsStayRepair")
    OR stay.id IN (SELECT "malformedId" FROM "_PmsStayRepair" WHERE "malformedId" IS NOT NULL)
  )
ON CONFLICT (id) DO NOTHING;

UPDATE "RoomStay" stay
SET
  "deletedAt" = CURRENT_TIMESTAMP,
  "deletionReason" = CASE
    WHEN stay.id IN (SELECT "historicalId" FROM "_PmsStayRepair")
      THEN 'Conciliación PMS v1.1.6: transición histórica consolidada en CHECK_OUT canónico.'
    ELSE 'Conciliación PMS v1.1.6: ID + Localizador fueron concatenados por el lector anterior.'
  END
WHERE stay."deletedAt" IS NULL
  AND (
    stay.id IN (SELECT "historicalId" FROM "_PmsStayRepair")
    OR stay.id IN (SELECT "malformedId" FROM "_PmsStayRepair" WHERE "malformedId" IS NOT NULL)
  );

-- Las nueve ReservationReference siguientes sólo nacieron de los IDs
-- concatenados y no tienen garantías, novedades, multas ni caja asociadas.
INSERT INTO "AuditLog" (
  id, entity, "entityId", action, summary, before, after, reason, "createdAt", "isDemo"
)
SELECT
  'pms-reference-v116-' || reservation.id,
  'ReservationReference',
  reservation.id,
  'ELIMINAR'::"AuditAction",
  'Referencia falsa retirada por conciliación PMS',
  jsonb_build_object('code', reservation.code, 'status', reservation.status),
  jsonb_build_object('deletedAt', CURRENT_TIMESTAMP),
  'El lector anterior concatenó ID de reserva + Localizador.',
  CURRENT_TIMESTAMP,
  false
FROM "ReservationReference" reservation
WHERE reservation."deletedAt" IS NULL
  AND reservation.code IN (
    '75103832539932938','75343346616300632','75346796936294180',
    '75343946589378654','75346385454503037','75344816853936470',
    '75345492562886254','75243892552596378','75243792552593159'
  )
ON CONFLICT (id) DO NOTHING;

UPDATE "ReservationReference"
SET "deletedAt" = CURRENT_TIMESTAMP
WHERE "deletedAt" IS NULL
  AND code IN (
    '75103832539932938','75343346616300632','75346796936294180',
    '75343946589378654','75346385454503037','75344816853936470',
    '75345492562886254','75243892552596378','75243792552593159'
  );

-- Última defensa: una sola fila viva por reserva, habitación y comienzo de
-- estancia. Una reentrada real tiene otra llegada; una extensión conserva la
-- llegada y actualiza la misma fila.
CREATE UNIQUE INDEX "RoomStay_live_occurrence_key"
  ON "RoomStay"("reservationId", "roomId", "arrivalDate")
  WHERE "deletedAt" IS NULL
    AND "roomId" IS NOT NULL
    AND "arrivalDate" IS NOT NULL;
