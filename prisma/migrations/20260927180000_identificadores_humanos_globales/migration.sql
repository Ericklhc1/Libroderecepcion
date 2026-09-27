BEGIN;

-- Identificador humano global para registros operativos.
--
-- La secuencia es deliberadamente compartida por todas las entidades visibles.
-- PostgreSQL serializa nextval() de forma atómica, no reutiliza números tras
-- rollback y evita colisiones bajo concurrencia. Los IDs técnicos existentes
-- permanecen intactos.

CREATE SEQUENCE human_operational_id_seq
  AS INTEGER
  START WITH 1000
  INCREMENT BY 1
  NO CYCLE;

ALTER TABLE "Shift"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "ShiftHandover"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "SupervisionShift"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "SupervisionShiftHandover"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "OperationalEntry"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "Task"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "FollowUp"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "Alert"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "Guarantee"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "CashCount"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "CashTransfer"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "Announcement"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "Fine"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "ChecklistRun"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "AuditFinding"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "CorrectiveMeasure"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "CashMovement"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "CashAudit"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "GymPass"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "KeyInventoryCount"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);
ALTER TABLE "ShiftCashClosure"
  ADD COLUMN "humanId" INTEGER NOT NULL DEFAULT nextval('human_operational_id_seq'::regclass);

CREATE UNIQUE INDEX "Shift_humanId_key" ON "Shift"("humanId");
CREATE UNIQUE INDEX "ShiftHandover_humanId_key" ON "ShiftHandover"("humanId");
CREATE UNIQUE INDEX "SupervisionShift_humanId_key" ON "SupervisionShift"("humanId");
CREATE UNIQUE INDEX "SupervisionShiftHandover_humanId_key" ON "SupervisionShiftHandover"("humanId");
CREATE UNIQUE INDEX "OperationalEntry_humanId_key" ON "OperationalEntry"("humanId");
CREATE UNIQUE INDEX "Task_humanId_key" ON "Task"("humanId");
CREATE UNIQUE INDEX "FollowUp_humanId_key" ON "FollowUp"("humanId");
CREATE UNIQUE INDEX "Alert_humanId_key" ON "Alert"("humanId");
CREATE UNIQUE INDEX "Guarantee_humanId_key" ON "Guarantee"("humanId");
CREATE UNIQUE INDEX "CashCount_humanId_key" ON "CashCount"("humanId");
CREATE UNIQUE INDEX "CashTransfer_humanId_key" ON "CashTransfer"("humanId");
CREATE UNIQUE INDEX "Announcement_humanId_key" ON "Announcement"("humanId");
CREATE UNIQUE INDEX "Fine_humanId_key" ON "Fine"("humanId");
CREATE UNIQUE INDEX "ChecklistRun_humanId_key" ON "ChecklistRun"("humanId");
CREATE UNIQUE INDEX "AuditFinding_humanId_key" ON "AuditFinding"("humanId");
CREATE UNIQUE INDEX "CorrectiveMeasure_humanId_key" ON "CorrectiveMeasure"("humanId");
CREATE UNIQUE INDEX "CashMovement_humanId_key" ON "CashMovement"("humanId");
CREATE UNIQUE INDEX "CashAudit_humanId_key" ON "CashAudit"("humanId");
CREATE UNIQUE INDEX "GymPass_humanId_key" ON "GymPass"("humanId");
CREATE UNIQUE INDEX "KeyInventoryCount_humanId_key" ON "KeyInventoryCount"("humanId");
CREATE UNIQUE INDEX "ShiftCashClosure_humanId_key" ON "ShiftCashClosure"("humanId");

-- Vista transversal: una sola fuente de lectura para la búsqueda global.
-- No reemplaza ninguna tabla ni relación; sólo proyecta datos operativos.
CREATE VIEW "HumanOperationalRecord" AS
SELECT
  e."humanId",
  'OperationalEntry'::text AS "entityType",
  e."id" AS "entityId",
  CASE WHEN e."type"::text = 'INCIDENCIA' THEN 'Incidencia' ELSE 'Novedad' END AS "kind",
  e."title",
  e."description" AS "summary",
  e."status"::text AS "status",
  r."number" AS "roomNumber",
  g."fullName" AS "guestName",
  COALESCE(o."name", c."name") AS "responsible",
  COALESCE(e."category", d."name", e."type"::text) AS "category",
  e."occurredAt" AS "createdAt",
  '/libro/' || e."id" AS "href",
  NULL::text AS "targetUserId",
  NULL::text AS "scope",
  NULL::text AS "createdByUserId"
FROM "OperationalEntry" e
LEFT JOIN "Room" r ON r."id" = e."roomId"
LEFT JOIN "GuestReference" g ON g."id" = e."guestId"
LEFT JOIN "User" o ON o."id" = e."ownerId"
LEFT JOIN "User" c ON c."id" = e."createdById"
LEFT JOIN "Department" d ON d."id" = e."departmentId"
WHERE e."deletedAt" IS NULL

UNION ALL
SELECT
  t."humanId", 'Task', t."id", 'Tarea', t."title", t."description",
  t."status"::text, r."number", g."fullName", COALESCE(a."name", c."name"),
  COALESCE(d."name", t."origin"::text), t."createdAt", '/tareas/' || t."id",
  NULL::text, NULL::text, NULL::text
FROM "Task" t
LEFT JOIN "Room" r ON r."id" = t."roomId"
LEFT JOIN "GuestReference" g ON g."id" = t."guestId"
LEFT JOIN "User" a ON a."id" = t."assigneeId"
LEFT JOIN "User" c ON c."id" = t."createdById"
LEFT JOIN "Department" d ON d."id" = t."departmentId"
WHERE t."deletedAt" IS NULL

UNION ALL
SELECT
  f."humanId", 'FollowUp', f."id", 'Seguimiento', f."action",
  COALESCE(f."nextAction", f."result", f."description", f."notes"),
  f."status"::text, r."number", g."fullName", o."name",
  COALESCE(f."origin", 'SEGUIMIENTO'), f."createdAt",
  '/seguimientos?q=%23' || f."humanId"::text, f."ownerId", f."visibility"::text, f."createdById"
FROM "FollowUp" f
LEFT JOIN "User" o ON o."id" = f."ownerId"
LEFT JOIN "OperationalEntry" e ON e."id" = f."entryId"
LEFT JOIN "Task" t ON t."id" = f."taskId"
LEFT JOIN "Room" r ON r."id" = COALESCE(e."roomId", t."roomId")
LEFT JOIN "GuestReference" g ON g."id" = COALESCE(e."guestId", t."guestId")
WHERE f."deletedAt" IS NULL

UNION ALL
SELECT
  a."humanId", 'Alert', a."id", 'Alerta', a."title", a."message",
  a."status"::text, NULL::text, g."fullName", COALESCE(r."name", c."name"),
  a."type"::text, a."createdAt", '/alertas?q=%23' || a."humanId"::text,
  NULL::text, NULL::text, NULL::text
FROM "Alert" a
LEFT JOIN "GuestReference" g ON g."id" = a."guestId"
LEFT JOIN "User" r ON r."id" = a."resolvedById"
LEFT JOIN "User" c ON c."id" = a."createdById"

UNION ALL
SELECT
  s."humanId", 'Shift', s."id", 'Turno',
  'Turno ' || s."type"::text || ' ' || to_char(s."date", 'DD/MM/YYYY'),
  s."notes", s."status"::text, NULL::text, NULL::text, u."name",
  CASE WHEN s."emergency" THEN 'EMERGENCIA' ELSE s."type"::text END,
  s."createdAt", '/turno', NULL::text, NULL::text, NULL::text
FROM "Shift" s
LEFT JOIN "User" u ON u."id" = s."createdById"

UNION ALL
SELECT
  h."humanId", 'ShiftHandover', h."id", 'Entrega de turno',
  'Entrega de turno', h."notes", h."status"::text, NULL::text, NULL::text,
  u."name", 'TURNO', h."createdAt", '/turno/entrega/' || h."id",
  NULL::text, NULL::text, NULL::text
FROM "ShiftHandover" h
LEFT JOIN "User" u ON u."id" = h."issuedById"

UNION ALL
SELECT
  sh."humanId", 'SupervisionShiftHandover', sh."id", 'Entrega de Supervisión',
  'Entrega de Supervisión', sh."note",
  CASE WHEN sh."receivedAt" IS NULL THEN 'PENDIENTE' ELSE 'RECIBIDA' END,
  NULL::text, NULL::text, u."name", 'SUPERVISION',
  sh."issuedAt", '/supervision', NULL::text, NULL::text, NULL::text
FROM "SupervisionShiftHandover" sh
LEFT JOIN "User" u ON u."id" = sh."issuedById"

UNION ALL
SELECT
  ss."humanId", 'SupervisionShift', ss."id", 'Turno de Supervisión',
  'Turno de Supervisión', array_to_string(ss."priorities", ' · '),
  ss."status"::text, NULL::text, NULL::text, u."name", 'SUPERVISION',
  ss."createdAt", '/supervision', NULL::text, NULL::text, NULL::text
FROM "SupervisionShift" ss
LEFT JOIN "User" u ON u."id" = ss."supervisorId"

UNION ALL
SELECT
  gu."humanId", 'Guarantee', gu."id", 'Garantía',
  COALESCE(gu."guestName", gu."reference", 'Garantía'),
  gu."notes", gu."state"::text, gu."roomNumber", gu."guestName", u."name",
  gu."kind"::text, gu."createdAt",
  '/caja?q=%23' || gu."humanId"::text || '&seccion=garantias', NULL::text, NULL::text, NULL::text
FROM "Guarantee" gu
LEFT JOIN "User" u ON u."id" = gu."createdById"
WHERE gu."deletedAt" IS NULL

UNION ALL
SELECT
  cm."humanId", 'CashMovement', cm."id", 'Movimiento de caja',
  cm."kind", COALESCE(cm."reference", cm."notes"),
  CASE WHEN cm."voidedAt" IS NULL THEN 'VIGENTE' ELSE 'ANULADO' END,
  r."number", g."fullName", u."name", cm."direction",
  cm."createdAt", '/caja?q=%23' || cm."humanId"::text || '&seccion=movimientos',
  NULL::text, NULL::text, NULL::text
FROM "CashMovement" cm
LEFT JOIN "Room" r ON r."id" = cm."roomId"
LEFT JOIN "GuestReference" g ON g."id" = cm."guestId"
LEFT JOIN "User" u ON u."id" = cm."createdById"

UNION ALL
SELECT
  ca."humanId", 'CashAudit', ca."id", 'Arqueo de caja',
  'Arqueo ' || ca."currency", ca."notes",
  CASE WHEN ca."difference" = 0 THEN 'CUADRA' ELSE 'DIFERENCIA' END,
  NULL::text, NULL::text, u."name", ca."currency",
  ca."createdAt", '/caja?q=%23' || ca."humanId"::text || '&seccion=auditorias',
  NULL::text, NULL::text, NULL::text
FROM "CashAudit" ca
LEFT JOIN "User" u ON u."id" = ca."countedById"

UNION ALL
SELECT
  cc."humanId", 'CashCount', cc."id", 'Arqueo de entrega',
  'Arqueo de entrega · ' || cc."kind"::text, cc."notes",
  cc."kind"::text, NULL::text, NULL::text, u."name", 'CAJA',
  cc."countedAt", '/turno/entrega/' || cc."handoverId",
  NULL::text, NULL::text, NULL::text
FROM "CashCount" cc
LEFT JOIN "User" u ON u."id" = cc."countedById"

UNION ALL
SELECT
  ct."humanId", 'CashTransfer', ct."id", 'Transferencia de caja',
  'Transferencia ' || ct."currency", COALESCE(ct."reference", ct."notes"),
  'REGISTRADA', NULL::text, NULL::text, u."name", ct."currency",
  ct."createdAt", '/turno/entrega/' || ct."handoverId",
  NULL::text, NULL::text, NULL::text
FROM "CashTransfer" ct
LEFT JOIN "User" u ON u."id" = ct."createdById"

UNION ALL
SELECT
  sc."humanId", 'ShiftCashClosure', sc."id", 'Cierre de caja',
  'Cierre de caja', sc."notes",
  CASE WHEN sc."reopenedAt" IS NULL THEN 'CERRADO' ELSE 'REABIERTO' END,
  NULL::text, NULL::text, u."name", 'CAJA',
  sc."closedAt", '/turno', NULL::text, NULL::text, NULL::text
FROM "ShiftCashClosure" sc
LEFT JOIN "User" u ON u."id" = sc."closedById"

UNION ALL
SELECT
  gp."humanId", 'GymPass', gp."id", 'Folio de gimnasio',
  'Folio de gimnasio · Hab. ' || gp."roomNumber", gp."guestName",
  gp."status", gp."roomNumber", gp."guestName", u."name", 'GIMNASIO',
  gp."issuedAt", '/caja?q=%23' || gp."humanId"::text || '&seccion=gimnasio',
  NULL::text, NULL::text, NULL::text
FROM "GymPass" gp
LEFT JOIN "User" u ON u."id" = gp."receptionistId"

UNION ALL
SELECT
  fi."humanId", 'Fine', fi."id", 'Multa',
  'Multa · Hab. ' || r."number", fi."reason", fi."status"::text,
  r."number", fi."guestName", u."name", fi."kind"::text,
  fi."createdAt", '/habitaciones', NULL::text, NULL::text, NULL::text
FROM "Fine" fi
LEFT JOIN "Room" r ON r."id" = fi."roomId"
LEFT JOIN "User" u ON u."id" = fi."createdById"
WHERE fi."deletedAt" IS NULL

UNION ALL
SELECT
  an."humanId", 'Announcement', an."id", 'Comunicado',
  an."title", an."body",
  CASE WHEN an."active" THEN 'ACTIVO' ELSE 'RETIRADO' END,
  NULL::text, NULL::text, u."name", 'COMUNICADO',
  an."createdAt", '/supervision', an."targetUserId", an."scope"::text, an."createdById"
FROM "Announcement" an
LEFT JOIN "User" u ON u."id" = an."createdById"
WHERE an."deletedAt" IS NULL

UNION ALL
SELECT
  cr."humanId", 'ChecklistRun', cr."id",
  CASE WHEN cr."mode"::text = 'AUDITORIA_SORPRESA' THEN 'Auditoría' ELSE 'Ronda' END,
  cr."templateName", COALESCE(cr."resultSummary", cr."notes"), cr."status"::text,
  NULL::text, NULL::text, u."name", cr."mode"::text,
  cr."startedAt", '/supervision/auditorias', NULL::text, NULL::text, NULL::text
FROM "ChecklistRun" cr
LEFT JOIN "User" u ON u."id" = cr."runById"
WHERE cr."deletedAt" IS NULL

UNION ALL
SELECT
  af."humanId", 'AuditFinding', af."id", 'Hallazgo de auditoría',
  af."title", af."description",
  CASE WHEN af."confirmed" THEN 'CONFIRMADO' ELSE 'PENDIENTE' END,
  NULL::text, NULL::text, NULL::text, af."severity"::text,
  af."createdAt", '/supervision/auditorias', NULL::text, NULL::text, NULL::text
FROM "AuditFinding" af
WHERE af."deletedAt" IS NULL

UNION ALL
SELECT
  co."humanId", 'CorrectiveMeasure', co."id", 'Medida correctiva',
  co."title", co."action", co."status"::text,
  NULL::text, NULL::text, u."name", 'CORRECTIVA',
  co."createdAt", '/supervision/auditorias', NULL::text, NULL::text, NULL::text
FROM "CorrectiveMeasure" co
LEFT JOIN "User" u ON u."id" = co."assigneeId"
WHERE co."deletedAt" IS NULL

UNION ALL
SELECT
  ki."humanId", 'KeyInventoryCount', ki."id", 'Inventario de llaves',
  'Inventario de llaves · Piso ' || ki."floor"::text, ki."notes", 'REGISTRADO',
  NULL::text, NULL::text, u."name", 'LLAVES',
  ki."countedAt", '/llaves', NULL::text, NULL::text, NULL::text
FROM "KeyInventoryCount" ki
LEFT JOIN "User" u ON u."id" = ki."countedById";

-- Una sola marca de auditoría documenta la migración histórica completa.
INSERT INTO "AuditLog" (
  "id", "entity", "entityId", "action", "summary", "userId",
  "before", "after", "reason", "createdAt", "isDemo"
)
VALUES (
  'human-id-migration-20260927',
  'System',
  'human-operational-id',
  'CONFIGURAR',
  'Asignación inicial de identificadores humanos globales',
  NULL,
  NULL,
  jsonb_build_object(
    'sequence', 'human_operational_id_seq',
    'start', 1000,
    'lastAssigned', (SELECT last_value FROM human_operational_id_seq),
    'strategy', 'shared-postgresql-sequence',
    'migration', '20260927180000_identificadores_humanos_globales'
  ),
  'Migración no destructiva: conserva IDs técnicos y asigna un correlativo humano único a registros históricos.',
  NOW(),
  FALSE
)
ON CONFLICT ("id") DO NOTHING;

COMMIT;
