-- Read-only views over existing relations. No data rewrite, new records or engine.
-- UNION (not UNION ALL) terminates cycles and keeps all originating follow-ups.
CREATE VIEW "OperationalSourceFollowUp" AS
WITH RECURSIVE edges(kind, id, parent_kind, parent_id) AS (
  SELECT 'task'::text, id, 'alert'::text, "alertId" FROM "Task" WHERE "alertId" IS NOT NULL
  UNION ALL
  SELECT 'alert'::text, id, 'task'::text, "taskId" FROM "Alert" WHERE "taskId" IS NOT NULL
), origins(kind, id, "followUpId") AS (
  SELECT 'task'::text, id, "followUpId" FROM "Task" WHERE "followUpId" IS NOT NULL
  UNION
  SELECT 'alert'::text, id, "followUpId" FROM "Alert" WHERE "followUpId" IS NOT NULL
  UNION
  SELECT e.kind, e.id, o."followUpId"
  FROM edges e JOIN origins o ON e.parent_kind=o.kind AND e.parent_id=o.id
) SELECT kind, id, "followUpId" FROM origins;

CREATE VIEW "TaskSourceFollowUp" AS
SELECT id AS "taskId", "followUpId" FROM "OperationalSourceFollowUp" WHERE kind='task';
CREATE VIEW "AlertSourceFollowUp" AS
SELECT id AS "alertId", "followUpId" FROM "OperationalSourceFollowUp" WHERE kind='alert';
CREATE VIEW "AlarmSourceFollowUp" AS
SELECT a.id AS "alarmId", a."sourceId" AS "followUpId"
FROM "OperationalAlarm" a JOIN "FollowUp" f ON f.id=a."sourceId" WHERE a."sourceEntity"='FollowUp'
UNION
SELECT a.id AS "alarmId", o."followUpId"
FROM "OperationalAlarm" a JOIN "OperationalSourceFollowUp" o ON o.id=a."sourceId"
WHERE (a."sourceEntity"='Task' AND o.kind='task') OR (a."sourceEntity"='Alert' AND o.kind='alert');

-- Audit remains immutable. Reader scope follows native sources before pagination.
CREATE VIEW "AuditSourceFollowUp" AS
WITH refs AS (
 SELECT id AS "auditLogId", entity AS kind, "entityId" AS "sourceId" FROM "AuditLog"
 UNION
 SELECT id, "after"->>'sourceEntity', "after"->>'sourceEntityId'
 FROM "AuditLog" WHERE entity='FrontiProactiveSignal'
), comment_origins AS (
 SELECT c.id, c."followUpId" FROM "Comment" c WHERE c."followUpId" IS NOT NULL
 UNION
 SELECT c.id, o."followUpId" FROM "Comment" c JOIN "OperationalSourceFollowUp" o
 ON (o.kind='task' AND o.id=c."taskId") OR (o.kind='alert' AND o.id=c."alertId")
)
SELECT r."auditLogId", f.id AS "followUpId" FROM refs r JOIN "FollowUp" f ON r.kind='FollowUp' AND r."sourceId"=f.id
UNION
SELECT r."auditLogId", o."followUpId" FROM refs r JOIN "OperationalSourceFollowUp" o
 ON (r.kind='Task' AND o.kind='task' AND r."sourceId"=o.id) OR (r.kind='Alert' AND o.kind='alert' AND r."sourceId"=o.id)
UNION
SELECT r."auditLogId", c."followUpId" FROM refs r JOIN comment_origins c ON r.kind='Comment' AND r."sourceId"=c.id
UNION
SELECT r."auditLogId", a."followUpId" FROM refs r JOIN "AlarmSourceFollowUp" a ON r.kind='OperationalAlarm' AND r."sourceId"=a."alarmId"
UNION
SELECT r."auditLogId", a."followUpId" FROM refs r JOIN "OperationalAlarmRecipient" recipient ON r.kind='OperationalAlarmRecipient' AND r."sourceId"=recipient.id
 JOIN "AlarmSourceFollowUp" a ON a."alarmId"=recipient."alarmId";
