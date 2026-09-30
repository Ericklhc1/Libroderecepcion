-- AROH 1.36.0 · contexto operativo por habitación
-- Habitación es contexto de Novedades; no representa ocupación ni estado PMS.

ALTER TABLE "OperationalAlarm"
ADD COLUMN "roomNumber" TEXT;

CREATE INDEX "OperationalAlarm_roomNumber_status_idx"
ON "OperationalAlarm"("roomNumber", "status");

ALTER TABLE "GymPass"
ADD COLUMN "reservationCode" TEXT;

CREATE INDEX "GymPass_roomNumber_serviceDate_idx"
ON "GymPass"("roomNumber", "serviceDate");

CREATE INDEX "GymPass_reservationCode_idx"
ON "GymPass"("reservationCode");

CREATE INDEX "Guarantee_roomNumber_idx"
ON "Guarantee"("roomNumber");


-- Catálogo físico canónico del hotel. Habitación es contexto operativo, no PMS.
INSERT INTO "Room" ("id", "number", "floor", "active", "createdAt", "updatedAt")
VALUES
  ('room-401', '401', 4, TRUE, NOW(), NOW()),
  ('room-402', '402', 4, TRUE, NOW(), NOW()),
  ('room-403', '403', 4, TRUE, NOW(), NOW()),
  ('room-404', '404', 4, TRUE, NOW(), NOW()),
  ('room-405', '405', 4, TRUE, NOW(), NOW()),
  ('room-406', '406', 4, TRUE, NOW(), NOW()),
  ('room-407', '407', 4, TRUE, NOW(), NOW()),
  ('room-408', '408', 4, TRUE, NOW(), NOW()),
  ('room-409', '409', 4, TRUE, NOW(), NOW()),
  ('room-410', '410', 4, TRUE, NOW(), NOW()),
  ('room-411', '411', 4, TRUE, NOW(), NOW()),
  ('room-412', '412', 4, TRUE, NOW(), NOW()),
  ('room-413', '413', 4, TRUE, NOW(), NOW()),
  ('room-414', '414', 4, TRUE, NOW(), NOW()),
  ('room-415', '415', 4, TRUE, NOW(), NOW()),
  ('room-416', '416', 4, TRUE, NOW(), NOW()),
  ('room-417', '417', 4, TRUE, NOW(), NOW()),
  ('room-418', '418', 4, TRUE, NOW(), NOW()),
  ('room-419', '419', 4, TRUE, NOW(), NOW()),
  ('room-420', '420', 4, TRUE, NOW(), NOW()),
  ('room-421', '421', 4, TRUE, NOW(), NOW()),
  ('room-422', '422', 4, TRUE, NOW(), NOW()),
  ('room-423', '423', 4, TRUE, NOW(), NOW()),
  ('room-424', '424', 4, TRUE, NOW(), NOW()),
  ('room-425', '425', 4, TRUE, NOW(), NOW()),
  ('room-426', '426', 4, TRUE, NOW(), NOW()),
  ('room-427', '427', 4, TRUE, NOW(), NOW()),
  ('room-428', '428', 4, TRUE, NOW(), NOW()),
  ('room-429', '429', 4, TRUE, NOW(), NOW()),
  ('room-501', '501', 5, TRUE, NOW(), NOW()),
  ('room-502', '502', 5, TRUE, NOW(), NOW()),
  ('room-503', '503', 5, TRUE, NOW(), NOW()),
  ('room-504', '504', 5, TRUE, NOW(), NOW()),
  ('room-505', '505', 5, TRUE, NOW(), NOW()),
  ('room-506', '506', 5, TRUE, NOW(), NOW()),
  ('room-507', '507', 5, TRUE, NOW(), NOW()),
  ('room-508', '508', 5, TRUE, NOW(), NOW()),
  ('room-509', '509', 5, TRUE, NOW(), NOW()),
  ('room-510', '510', 5, TRUE, NOW(), NOW()),
  ('room-511', '511', 5, TRUE, NOW(), NOW()),
  ('room-512', '512', 5, TRUE, NOW(), NOW()),
  ('room-513', '513', 5, TRUE, NOW(), NOW()),
  ('room-514', '514', 5, TRUE, NOW(), NOW()),
  ('room-515', '515', 5, TRUE, NOW(), NOW()),
  ('room-516', '516', 5, TRUE, NOW(), NOW()),
  ('room-517', '517', 5, TRUE, NOW(), NOW()),
  ('room-518', '518', 5, TRUE, NOW(), NOW()),
  ('room-519', '519', 5, TRUE, NOW(), NOW()),
  ('room-520', '520', 5, TRUE, NOW(), NOW()),
  ('room-521', '521', 5, TRUE, NOW(), NOW()),
  ('room-522', '522', 5, TRUE, NOW(), NOW()),
  ('room-523', '523', 5, TRUE, NOW(), NOW()),
  ('room-524', '524', 5, TRUE, NOW(), NOW()),
  ('room-525', '525', 5, TRUE, NOW(), NOW()),
  ('room-526', '526', 5, TRUE, NOW(), NOW()),
  ('room-527', '527', 5, TRUE, NOW(), NOW()),
  ('room-528', '528', 5, TRUE, NOW(), NOW()),
  ('room-529', '529', 5, TRUE, NOW(), NOW()),
  ('room-530', '530', 5, TRUE, NOW(), NOW()),
  ('room-601', '601', 6, TRUE, NOW(), NOW()),
  ('room-602', '602', 6, TRUE, NOW(), NOW()),
  ('room-603', '603', 6, TRUE, NOW(), NOW()),
  ('room-604', '604', 6, TRUE, NOW(), NOW()),
  ('room-605', '605', 6, TRUE, NOW(), NOW()),
  ('room-606', '606', 6, TRUE, NOW(), NOW()),
  ('room-607', '607', 6, TRUE, NOW(), NOW()),
  ('room-608', '608', 6, TRUE, NOW(), NOW()),
  ('room-609', '609', 6, TRUE, NOW(), NOW()),
  ('room-610', '610', 6, TRUE, NOW(), NOW()),
  ('room-611', '611', 6, TRUE, NOW(), NOW()),
  ('room-612', '612', 6, TRUE, NOW(), NOW()),
  ('room-613', '613', 6, TRUE, NOW(), NOW()),
  ('room-614', '614', 6, TRUE, NOW(), NOW()),
  ('room-615', '615', 6, TRUE, NOW(), NOW()),
  ('room-616', '616', 6, TRUE, NOW(), NOW()),
  ('room-617', '617', 6, TRUE, NOW(), NOW()),
  ('room-618', '618', 6, TRUE, NOW(), NOW()),
  ('room-619', '619', 6, TRUE, NOW(), NOW()),
  ('room-620', '620', 6, TRUE, NOW(), NOW()),
  ('room-621', '621', 6, TRUE, NOW(), NOW()),
  ('room-622', '622', 6, TRUE, NOW(), NOW()),
  ('room-623', '623', 6, TRUE, NOW(), NOW()),
  ('room-624', '624', 6, TRUE, NOW(), NOW()),
  ('room-625', '625', 6, TRUE, NOW(), NOW()),
  ('room-626', '626', 6, TRUE, NOW(), NOW()),
  ('room-627', '627', 6, TRUE, NOW(), NOW()),
  ('room-628', '628', 6, TRUE, NOW(), NOW()),
  ('room-629', '629', 6, TRUE, NOW(), NOW()),
  ('room-630', '630', 6, TRUE, NOW(), NOW());
ON CONFLICT ("number") DO UPDATE
SET "floor" = EXCLUDED."floor", "active" = TRUE, "updatedAt" = NOW();
