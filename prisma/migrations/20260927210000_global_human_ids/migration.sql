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


-- Índice lógico de búsqueda: no duplica datos, sólo proyecta las entidades
-- numeradas en una forma uniforme. Los permisos se aplican en el servicio.
CREATE VIEW "OperationalHumanSearch" AS
SELECT e."humanId", e."id" AS "technicalId", 'OperationalEntry'::text AS entity, 'OPEN'::text AS domain,
       CASE WHEN e."type" = 'INCIDENCIA' THEN 'Incidencia' ELSE 'Novedad' END AS "kindLabel",
       e."title", e."description" AS summary, e."status"::text AS status,
       r."number" AS room, g."fullName" AS guest, COALESCE(owner."name", creator."name") AS person,
       COALESCE(e."category", d."name", e."type"::text) AS category, e."createdAt" AS "createdAt",
       NULL::text AS "targetUserId",
       concat_ws(' ', e."humanId"::text, e."title", e."description", e."category", e."type"::text,
         e."status"::text, r."number", g."fullName", owner."name", owner."username",
         creator."name", creator."username", d."name", array_to_string(e."tags", ' ')) AS "searchText"
FROM "OperationalEntry" e
LEFT JOIN "Room" r ON r."id" = e."roomId"
LEFT JOIN "GuestReference" g ON g."id" = e."guestId"
LEFT JOIN "User" owner ON owner."id" = e."ownerId"
JOIN "User" creator ON creator."id" = e."createdById"
LEFT JOIN "Department" d ON d."id" = e."departmentId"
WHERE e."deletedAt" IS NULL

UNION ALL
SELECT t."humanId", t."id", 'Task', 'OPEN', 'Tarea', t."title", t."description", t."status"::text,
       r."number", g."fullName", COALESCE(assignee."name", creator."name"),
       COALESCE(d."name", t."origin"::text), t."createdAt", NULL::text,
       concat_ws(' ', t."humanId"::text, t."title", t."description", t."status"::text, t."origin"::text,
         r."number", g."fullName", assignee."name", assignee."username", creator."name",
         creator."username", d."name", array_to_string(t."tags", ' '))
FROM "Task" t
LEFT JOIN "Room" r ON r."id" = t."roomId"
LEFT JOIN "GuestReference" g ON g."id" = t."guestId"
LEFT JOIN "User" assignee ON assignee."id" = t."assigneeId"
JOIN "User" creator ON creator."id" = t."createdById"
LEFT JOIN "Department" d ON d."id" = t."departmentId"
WHERE t."deletedAt" IS NULL

UNION ALL
SELECT f."humanId", f."id", 'FollowUp', 'OPEN', 'Seguimiento', f."action",
       COALESCE(f."nextAction", f."result", f."description"), f."status"::text,
       r."number", g."fullName", owner."name", COALESCE(f."origin", 'Seguimiento'),
       f."createdAt", NULL::text,
       concat_ws(' ', f."humanId"::text, f."action", f."nextAction", f."result", f."description",
         f."notes", f."status"::text, f."origin", r."number", g."fullName", owner."name",
         owner."username", creator."name", creator."username", e."title", e."description")
FROM "FollowUp" f
JOIN "User" owner ON owner."id" = f."ownerId"
JOIN "User" creator ON creator."id" = f."createdById"
LEFT JOIN "OperationalEntry" e ON e."id" = f."entryId"
LEFT JOIN "Room" r ON r."id" = e."roomId"
LEFT JOIN "GuestReference" g ON g."id" = e."guestId"
WHERE f."deletedAt" IS NULL

UNION ALL
SELECT a."humanId", a."id", 'Alert', 'OPEN', 'Alerta', a."title", a."message", a."status"::text,
       r."number", g."fullName", creator."name", a."type"::text, a."createdAt", NULL::text,
       concat_ws(' ', a."humanId"::text, a."title", a."message", a."status"::text, a."type"::text,
         r."number", g."fullName", creator."name", creator."username", e."title", e."description")
FROM "Alert" a
LEFT JOIN "OperationalEntry" e ON e."id" = a."entryId"
LEFT JOIN "Room" r ON r."id" = e."roomId"
LEFT JOIN "GuestReference" g ON g."id" = COALESCE(a."guestId", e."guestId")
LEFT JOIN "User" creator ON creator."id" = a."createdById"
WHERE a."deletedAt" IS NULL

UNION ALL
SELECT s."humanId", s."id", 'Shift', 'SHIFT', 'Turno',
       ('Turno ' || s."type"::text || ' · ' || s."date"::text), s."notes", s."status"::text,
       NULL::text, NULL::text, creator."name", s."type"::text, s."createdAt", NULL::text,
       concat_ws(' ', s."humanId"::text, 'turno', s."type"::text, s."status"::text, s."date"::text,
         s."notes", creator."name", creator."username",
         CASE WHEN s."emergency" THEN 'emergencia contingencia' END)
FROM "Shift" s
LEFT JOIN "User" creator ON creator."id" = s."createdById"

UNION ALL
SELECT h."humanId", h."id", 'ShiftHandover', 'SHIFT', 'Entrega de turno',
       ('Entrega de turno · ' || s."type"::text || ' ' || s."date"::text), h."notes", h."status"::text,
       NULL::text, NULL::text, COALESCE(receiver."name", issuer."name"), 'ENTREGA_TURNO',
       h."createdAt", NULL::text,
       concat_ws(' ', h."humanId"::text, 'entrega turno', h."status"::text, s."type"::text,
         s."date"::text, h."notes", h."receiverObservations", issuer."name", issuer."username",
         receiver."name", receiver."username")
FROM "ShiftHandover" h
JOIN "Shift" s ON s."id" = h."fromShiftId"
JOIN "User" issuer ON issuer."id" = h."issuedById"
LEFT JOIN "User" receiver ON receiver."id" = h."receivedById"

UNION ALL
SELECT a."humanId", a."id", 'Announcement', 'ANNOUNCEMENT', 'Comunicado', a."title", a."body",
       CASE WHEN a."active" THEN 'ACTIVO' ELSE 'INACTIVO' END, NULL::text, NULL::text, creator."name",
       'COMUNICADO', a."createdAt", a."targetUserId",
       concat_ws(' ', a."humanId"::text, a."title", a."body", 'comunicado',
         CASE WHEN a."active" THEN 'activo' ELSE 'inactivo' END, creator."name", creator."username")
FROM "Announcement" a
JOIN "User" creator ON creator."id" = a."createdById"
WHERE a."deletedAt" IS NULL

UNION ALL
SELECT g."humanId", g."id", 'Guarantee', 'CASH', 'Garantía',
       COALESCE(g."guestName", g."reference", 'Garantía'), (g."currency" || ' ' || g."amount"::text),
       g."state"::text, g."roomNumber", g."guestName", creator."name", g."kind"::text, g."createdAt",
       NULL::text,
       concat_ws(' ', g."humanId"::text, 'garantia garantía caja', g."guestName", g."roomNumber",
         g."reference", g."state"::text, g."kind"::text, g."currency", g."amount"::text,
         g."notes", creator."name", creator."username")
FROM "Guarantee" g
JOIN "User" creator ON creator."id" = g."createdById"
WHERE g."deletedAt" IS NULL

UNION ALL
SELECT m."humanId", m."id", 'CashMovement', 'CASH', 'Movimiento de caja',
       COALESCE(m."reference", m."kind"), (m."currency" || ' ' || m."amount"::text || ' · ' || m."direction"),
       CASE WHEN m."voidedAt" IS NULL THEN 'VIGENTE' ELSE 'ANULADO' END, r."number", g."fullName",
       creator."name", m."kind", m."createdAt", NULL::text,
       concat_ws(' ', m."humanId"::text, 'caja movimiento ingreso egreso ajuste', m."kind",
         m."direction", m."currency", m."amount"::text, m."reference", m."notes", r."number",
         g."fullName", creator."name", creator."username",
         CASE WHEN m."voidedAt" IS NOT NULL THEN 'anulado anulacion anulación' END)
FROM "CashMovement" m
LEFT JOIN "Room" r ON r."id" = m."roomId"
LEFT JOIN "GuestReference" g ON g."id" = m."guestId"
JOIN "User" creator ON creator."id" = m."createdById"

UNION ALL
SELECT a."humanId", a."id", 'CashAudit', 'CASH', 'Arqueo',
       ('Arqueo de caja · ' || a."currency"),
       ('Esperado ' || a."expectedAmount"::text || ' · contado ' || a."countedAmount"::text ||
        ' · diferencia ' || a."difference"::text),
       CASE WHEN a."difference" = 0 THEN 'CUADRA' ELSE 'CON_DIFERENCIA' END,
       NULL::text, NULL::text, u."name", 'ARQUEO_CAJA', a."createdAt", NULL::text,
       concat_ws(' ', a."humanId"::text, 'arqueo caja', a."currency", a."expectedAmount"::text,
         a."countedAmount"::text, a."difference"::text, a."notes", u."name", u."username")
FROM "CashAudit" a
JOIN "User" u ON u."id" = a."countedById"

UNION ALL
SELECT c."humanId", c."id", 'CashCount', 'CASH', 'Arqueo de entrega',
       ('Arqueo ' || c."kind"::text || ' de entrega'), c."notes", c."kind"::text,
       NULL::text, NULL::text, u."name", 'ARQUEO_ENTREGA', c."countedAt", NULL::text,
       concat_ws(' ', c."humanId"::text, 'arqueo caja entrega', c."kind"::text, c."notes",
         u."name", u."username")
FROM "CashCount" c
JOIN "User" u ON u."id" = c."countedById"

UNION ALL
SELECT t."humanId", t."id", 'CashTransfer', 'CASH', 'Transferencia a Tesorería',
       'Transferencia a Tesorería', (t."currency" || ' ' || t."amount"::text), 'REGISTRADA',
       NULL::text, NULL::text, u."name", 'TESORERIA', t."createdAt", NULL::text,
       concat_ws(' ', t."humanId"::text, 'caja tesoreria tesorería transferencia egreso',
         t."currency", t."amount"::text, t."reference", t."notes", u."name", u."username")
FROM "CashTransfer" t
JOIN "User" u ON u."id" = t."createdById"

UNION ALL
SELECT p."humanId", p."id", 'GymPass', 'CASH', 'Folio de gimnasio',
       ('Folio de gimnasio · Hab. ' || p."roomNumber"), p."guestName", p."status",
       p."roomNumber", p."guestName", u."name", 'GIMNASIO', p."issuedAt", NULL::text,
       concat_ws(' ', p."humanId"::text, 'folio gimnasio', p."folio"::text, p."roomNumber",
         p."guestName", p."status", u."name", u."username")
FROM "GymPass" p
JOIN "User" u ON u."id" = p."receptionistId"

UNION ALL
SELECT c."humanId", c."id", 'ShiftCashClosure', 'CASH', 'Cierre de caja',
       ('Cierre de caja · turno ' || s."type"::text || ' ' || s."date"::text), c."notes",
       CASE WHEN c."reopenedAt" IS NULL THEN 'CERRADO' ELSE 'REABIERTO' END,
       NULL::text, NULL::text, u."name", 'CIERRE_CAJA', c."closedAt", NULL::text,
       concat_ws(' ', c."humanId"::text, 'cierre caja turno', s."type"::text, s."date"::text,
         c."notes", u."name", u."username",
         CASE WHEN c."reopenedAt" IS NULL THEN 'cerrado' ELSE 'reabierto' END)
FROM "ShiftCashClosure" c
JOIN "Shift" s ON s."id" = c."shiftId"
JOIN "User" u ON u."id" = c."closedById"

UNION ALL
SELECT f."humanId", f."id", 'Fine', 'ROOM', 'Multa', ('Multa · Hab. ' || r."number"), f."reason",
       f."status"::text, r."number", f."guestName", u."name", f."kind"::text, f."createdAt", NULL::text,
       concat_ws(' ', f."humanId"::text, 'multa', f."kind"::text, f."status"::text, r."number",
         f."reservationCode", f."guestName", f."reason", f."guestStatement", f."amount"::text,
         f."currency", u."name", u."username")
FROM "Fine" f
JOIN "Room" r ON r."id" = f."roomId"
JOIN "User" u ON u."id" = f."createdById"
WHERE f."deletedAt" IS NULL

UNION ALL
SELECT i."humanId", i."id", 'KeyInventoryCount', 'KEYS', 'Inventario de llaves',
       ('Inventario de llaves · piso ' || i."floor"::text), i."notes", 'REGISTRADO',
       NULL::text, NULL::text, u."name", 'LLAVES', i."countedAt", NULL::text,
       concat_ws(' ', i."humanId"::text, 'inventario llaves piso', i."floor"::text, i."notes",
         u."name", u."username")
FROM "KeyInventoryCount" i
JOIN "User" u ON u."id" = i."countedById"

UNION ALL
SELECT m."humanId", m."id", 'KeyMovement', 'KEYS', 'Movimiento de llave',
       ('Movimiento de llave · ' || k."code"), m."note", m."action"::text, r."number",
       NULL::text, u."name", 'LLAVES', m."at", NULL::text,
       concat_ws(' ', m."humanId"::text, 'llave llaves movimiento', k."code", m."action"::text,
         m."fromStatus"::text, m."toStatus"::text, r."number", m."note", u."name", u."username")
FROM "KeyMovement" m
JOIN "RoomKey" k ON k."id" = m."keyId"
LEFT JOIN "Room" r ON r."id" = m."roomId"
JOIN "User" u ON u."id" = m."userId"

UNION ALL
SELECT s."humanId", s."id", 'SupervisionShift', 'SUPERVISION', 'Turno de Supervisión',
       'Turno de Supervisión', array_to_string(s."priorities", ' · '), s."status"::text,
       NULL::text, NULL::text, u."name", 'SUPERVISION', s."startedAt", NULL::text,
       concat_ws(' ', s."humanId"::text, 'turno supervision supervisión', s."status"::text,
         array_to_string(s."priorities", ' '), u."name", u."username")
FROM "SupervisionShift" s
JOIN "User" u ON u."id" = s."supervisorId"

UNION ALL
SELECT h."humanId", h."id", 'SupervisionShiftHandover', 'SUPERVISION', 'Entrega de Supervisión',
       'Entrega de turno de Supervisión', h."note",
       CASE WHEN h."receivedAt" IS NULL THEN 'ENVIADA' ELSE 'RECIBIDA' END,
       NULL::text, NULL::text, COALESCE(receiver."name", issuer."name"), 'SUPERVISION',
       h."issuedAt", NULL::text,
       concat_ws(' ', h."humanId"::text, 'entrega supervision supervisión', h."note",
         issuer."name", issuer."username", receiver."name", receiver."username",
         CASE WHEN h."receivedAt" IS NULL THEN 'enviada' ELSE 'recibida' END)
FROM "SupervisionShiftHandover" h
JOIN "User" issuer ON issuer."id" = h."issuedById"
LEFT JOIN "User" receiver ON receiver."id" = h."receivedById"

UNION ALL
SELECT r."humanId", r."id", 'ChecklistRun', 'SUPERVISION',
       CASE WHEN r."mode" = 'AUDITORIA_SORPRESA' THEN 'Auditoría' ELSE 'Ronda' END,
       r."templateName", COALESCE(r."resultSummary", r."notes"), r."status"::text,
       NULL::text, NULL::text, u."name", r."mode"::text, r."startedAt", NULL::text,
       concat_ws(' ', r."humanId"::text, 'auditoria auditoría ronda supervision supervisión',
         r."templateName", r."mode"::text, r."status"::text, r."scope", r."sample",
         r."resultSummary", r."notes", u."name", u."username")
FROM "ChecklistRun" r
JOIN "User" u ON u."id" = r."runById"
WHERE r."deletedAt" IS NULL

UNION ALL
SELECT f."humanId", f."id", 'AuditFinding', 'SUPERVISION', 'Hallazgo de auditoría',
       f."title", f."description", CASE WHEN f."confirmed" THEN 'CONFIRMADO' ELSE 'PENDIENTE' END,
       NULL::text, NULL::text, NULL::text, f."severity"::text, f."createdAt", NULL::text,
       concat_ws(' ', f."humanId"::text, 'hallazgo auditoria auditoría', f."title", f."description",
         f."severity"::text, f."disclosure"::text,
         CASE WHEN f."confirmed" THEN 'confirmado' ELSE 'pendiente' END)
FROM "AuditFinding" f
WHERE f."deletedAt" IS NULL

UNION ALL
SELECT m."humanId", m."id", 'CorrectiveMeasure', 'SUPERVISION', 'Medida correctiva',
       m."title", m."action", m."status"::text, NULL::text, NULL::text, u."name",
       'MEDIDA_CORRECTIVA', m."createdAt", NULL::text,
       concat_ws(' ', m."humanId"::text, 'medida correctiva', m."title", m."action",
         m."status"::text, m."evidence", m."blockedReason", u."name", u."username")
FROM "CorrectiveMeasure" m
JOIN "User" u ON u."id" = m."assigneeId"
WHERE m."deletedAt" IS NULL;

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
