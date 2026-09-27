-- Identificador humano global para registros operativos.
-- Conserva todos los IDs técnicos existentes. El número visible se alimenta
-- exclusivamente desde una secuencia PostgreSQL compartida y no se reutiliza.
BEGIN;

CREATE SEQUENCE "OperationalHumanIdSeq"
  AS INTEGER
  INCREMENT BY 1
  MINVALUE 1000
  START WITH 1000
  NO CYCLE
  CACHE 1;

ALTER TABLE "Shift" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "ShiftHandover" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "SupervisionShift" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "SupervisionShiftHandover" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "OperationalEntry" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "Task" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "FollowUp" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "Alert" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "KeyMovement" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "KeyInventoryCount" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "Guarantee" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "CashCount" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "CashTransfer" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "Announcement" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "Fine" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "ChecklistRun" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "AuditFinding" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "CorrectiveMeasure" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "CashMovement" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "CashAudit" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "GymPass" ADD COLUMN "humanId" INTEGER;
ALTER TABLE "ShiftCashClosure" ADD COLUMN "humanId" INTEGER;

CREATE TEMP TABLE "_OperationalHumanIdBackfill" (
  entity text NOT NULL,
  id text NOT NULL,
  created_at timestamptz NOT NULL,
  human_id integer
) ON COMMIT DROP;

INSERT INTO "_OperationalHumanIdBackfill" (entity, id, created_at)
  SELECT 'Shift'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "Shift"
  UNION ALL
  SELECT 'ShiftHandover'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "ShiftHandover"
  UNION ALL
  SELECT 'SupervisionShift'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "SupervisionShift"
  UNION ALL
  SELECT 'SupervisionShiftHandover'::text AS entity, "id"::text AS id, "issuedAt"::timestamptz AS created_at FROM "SupervisionShiftHandover"
  UNION ALL
  SELECT 'OperationalEntry'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "OperationalEntry"
  UNION ALL
  SELECT 'Task'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "Task"
  UNION ALL
  SELECT 'FollowUp'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "FollowUp"
  UNION ALL
  SELECT 'Alert'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "Alert"
  UNION ALL
  SELECT 'KeyMovement'::text AS entity, "id"::text AS id, "at"::timestamptz AS created_at FROM "KeyMovement"
  UNION ALL
  SELECT 'KeyInventoryCount'::text AS entity, "id"::text AS id, "countedAt"::timestamptz AS created_at FROM "KeyInventoryCount"
  UNION ALL
  SELECT 'Guarantee'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "Guarantee"
  UNION ALL
  SELECT 'CashCount'::text AS entity, "id"::text AS id, "countedAt"::timestamptz AS created_at FROM "CashCount"
  UNION ALL
  SELECT 'CashTransfer'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "CashTransfer"
  UNION ALL
  SELECT 'Announcement'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "Announcement"
  UNION ALL
  SELECT 'Fine'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "Fine"
  UNION ALL
  SELECT 'ChecklistRun'::text AS entity, "id"::text AS id, "startedAt"::timestamptz AS created_at FROM "ChecklistRun"
  UNION ALL
  SELECT 'AuditFinding'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "AuditFinding"
  UNION ALL
  SELECT 'CorrectiveMeasure'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "CorrectiveMeasure"
  UNION ALL
  SELECT 'CashMovement'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "CashMovement"
  UNION ALL
  SELECT 'CashAudit'::text AS entity, "id"::text AS id, "createdAt"::timestamptz AS created_at FROM "CashAudit"
  UNION ALL
  SELECT 'GymPass'::text AS entity, "id"::text AS id, "issuedAt"::timestamptz AS created_at FROM "GymPass"
  UNION ALL
  SELECT 'ShiftCashClosure'::text AS entity, "id"::text AS id, "closedAt"::timestamptz AS created_at FROM "ShiftCashClosure";

WITH numbered AS (
  SELECT entity, id,
         999 + row_number() OVER (ORDER BY created_at ASC, entity ASC, id ASC) AS human_id
  FROM "_OperationalHumanIdBackfill"
)
UPDATE "_OperationalHumanIdBackfill" AS target
SET human_id = numbered.human_id
FROM numbered
WHERE target.entity = numbered.entity AND target.id = numbered.id;

UPDATE "Shift" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'Shift' AND source.id = target."id";

UPDATE "ShiftHandover" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'ShiftHandover' AND source.id = target."id";

UPDATE "SupervisionShift" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'SupervisionShift' AND source.id = target."id";

UPDATE "SupervisionShiftHandover" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'SupervisionShiftHandover' AND source.id = target."id";

UPDATE "OperationalEntry" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'OperationalEntry' AND source.id = target."id";

UPDATE "Task" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'Task' AND source.id = target."id";

UPDATE "FollowUp" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'FollowUp' AND source.id = target."id";

UPDATE "Alert" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'Alert' AND source.id = target."id";

UPDATE "KeyMovement" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'KeyMovement' AND source.id = target."id";

UPDATE "KeyInventoryCount" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'KeyInventoryCount' AND source.id = target."id";

UPDATE "Guarantee" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'Guarantee' AND source.id = target."id";

UPDATE "CashCount" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'CashCount' AND source.id = target."id";

UPDATE "CashTransfer" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'CashTransfer' AND source.id = target."id";

UPDATE "Announcement" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'Announcement' AND source.id = target."id";

UPDATE "Fine" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'Fine' AND source.id = target."id";

UPDATE "ChecklistRun" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'ChecklistRun' AND source.id = target."id";

UPDATE "AuditFinding" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'AuditFinding' AND source.id = target."id";

UPDATE "CorrectiveMeasure" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'CorrectiveMeasure' AND source.id = target."id";

UPDATE "CashMovement" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'CashMovement' AND source.id = target."id";

UPDATE "CashAudit" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'CashAudit' AND source.id = target."id";

UPDATE "GymPass" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'GymPass' AND source.id = target."id";

UPDATE "ShiftCashClosure" AS target
SET "humanId" = source.human_id
FROM "_OperationalHumanIdBackfill" AS source
WHERE source.entity = 'ShiftCashClosure' AND source.id = target."id";

DO $$
DECLARE
  max_human_id integer;
BEGIN
  SELECT MAX(human_id) INTO max_human_id FROM "_OperationalHumanIdBackfill";
  IF max_human_id IS NOT NULL THEN
    PERFORM setval('"OperationalHumanIdSeq"', max_human_id, true);
  END IF;
END
$$;

ALTER TABLE "Shift"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "Shift_humanId_key" ON "Shift"("humanId");

ALTER TABLE "ShiftHandover"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "ShiftHandover_humanId_key" ON "ShiftHandover"("humanId");

ALTER TABLE "SupervisionShift"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "SupervisionShift_humanId_key" ON "SupervisionShift"("humanId");

ALTER TABLE "SupervisionShiftHandover"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "SupervisionShiftHandover_humanId_key" ON "SupervisionShiftHandover"("humanId");

ALTER TABLE "OperationalEntry"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "OperationalEntry_humanId_key" ON "OperationalEntry"("humanId");

ALTER TABLE "Task"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "Task_humanId_key" ON "Task"("humanId");

ALTER TABLE "FollowUp"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "FollowUp_humanId_key" ON "FollowUp"("humanId");

ALTER TABLE "Alert"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "Alert_humanId_key" ON "Alert"("humanId");

ALTER TABLE "KeyMovement"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "KeyMovement_humanId_key" ON "KeyMovement"("humanId");

ALTER TABLE "KeyInventoryCount"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "KeyInventoryCount_humanId_key" ON "KeyInventoryCount"("humanId");

ALTER TABLE "Guarantee"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "Guarantee_humanId_key" ON "Guarantee"("humanId");

ALTER TABLE "CashCount"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "CashCount_humanId_key" ON "CashCount"("humanId");

ALTER TABLE "CashTransfer"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "CashTransfer_humanId_key" ON "CashTransfer"("humanId");

ALTER TABLE "Announcement"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "Announcement_humanId_key" ON "Announcement"("humanId");

ALTER TABLE "Fine"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "Fine_humanId_key" ON "Fine"("humanId");

ALTER TABLE "ChecklistRun"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "ChecklistRun_humanId_key" ON "ChecklistRun"("humanId");

ALTER TABLE "AuditFinding"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "AuditFinding_humanId_key" ON "AuditFinding"("humanId");

ALTER TABLE "CorrectiveMeasure"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "CorrectiveMeasure_humanId_key" ON "CorrectiveMeasure"("humanId");

ALTER TABLE "CashMovement"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "CashMovement_humanId_key" ON "CashMovement"("humanId");

ALTER TABLE "CashAudit"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "CashAudit_humanId_key" ON "CashAudit"("humanId");

ALTER TABLE "GymPass"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "GymPass_humanId_key" ON "GymPass"("humanId");

ALTER TABLE "ShiftCashClosure"
  ALTER COLUMN "humanId" SET DEFAULT nextval('"OperationalHumanIdSeq"'::regclass),
  ALTER COLUMN "humanId" SET NOT NULL;
CREATE UNIQUE INDEX "ShiftCashClosure_humanId_key" ON "ShiftCashClosure"("humanId");

-- Marca auditable del corte: <= historicalMax nació antes de esta migración;
-- los números posteriores son registros creados con la secuencia global.
INSERT INTO "SystemSetting" ("id", "key", "value", "category", "description", "updatedAt")
VALUES (
  'human-id-cutover-20260927',
  'human_id.cutover',
  jsonb_build_object(
    'migratedAt', CURRENT_TIMESTAMP,
    'historicalStart', 1000,
    'historicalMax', (SELECT MAX(human_id) FROM "_OperationalHumanIdBackfill"),
    'historicalRecordCount', (SELECT COUNT(*) FROM "_OperationalHumanIdBackfill"),
    'sequence', 'OperationalHumanIdSeq'
  ),
  'system',
  'Corte auditable de la migración al identificador humano global.',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value",
    "description" = EXCLUDED."description",
    "updatedAt" = EXCLUDED."updatedAt";

INSERT INTO "AuditLog" (
  "id", "entity", "entityId", "action", "summary", "after", "createdAt", "isDemo"
)
VALUES (
  'migration-human-id-global-20260927',
  'System',
  'human_id',
  'CONFIGURAR'::"AuditAction",
  'Migración a identificadores humanos globales aplicada a registros operativos.',
  jsonb_build_object(
    'historicalStart', 1000,
    'historicalMax', (SELECT MAX(human_id) FROM "_OperationalHumanIdBackfill"),
    'historicalRecordCount', (SELECT COUNT(*) FROM "_OperationalHumanIdBackfill"),
    'sequence', 'OperationalHumanIdSeq',
    'numberedEntities', 22
  ),
  CURRENT_TIMESTAMP,
  FALSE
);

COMMIT;
