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
