-- Extend the existing read-only provenance graph with follow-up source edges.
-- UNION terminates historical cycles. No historical rows or evidence are changed.
CREATE OR REPLACE VIEW "OperationalSourceFollowUp" AS
WITH RECURSIVE edges(kind, id, parent_kind, parent_id) AS (
  SELECT 'task'::text, id, 'alert'::text, "alertId" FROM "Task" WHERE "alertId" IS NOT NULL
  UNION ALL SELECT 'alert', id, 'task', "taskId" FROM "Alert" WHERE "taskId" IS NOT NULL
  UNION ALL SELECT 'task', id, 'followup', "followUpId" FROM "Task" WHERE "followUpId" IS NOT NULL
  UNION ALL SELECT 'alert', id, 'followup', "followUpId" FROM "Alert" WHERE "followUpId" IS NOT NULL
  UNION ALL SELECT 'followup', id, 'task', "taskId" FROM "FollowUp" WHERE "taskId" IS NOT NULL
  UNION ALL SELECT 'followup', id, lower("sourceEntity"), "sourceId" FROM "FollowUp"
    WHERE "sourceEntity" IN ('Task','Alert','FollowUp') AND "sourceId" IS NOT NULL
), origins(kind, id, "followUpId") AS (
  SELECT 'followup'::text, id, id FROM "FollowUp"
  UNION
  SELECT e.kind, e.id, o."followUpId"
  FROM edges e JOIN origins o ON e.parent_kind=o.kind AND e.parent_id=o.id
) SELECT kind, id, "followUpId" FROM origins;

CREATE VIEW "FollowUpSourceFollowUp" AS
SELECT id AS "descendantId", "followUpId" FROM "OperationalSourceFollowUp" WHERE kind='followup';

CREATE OR REPLACE VIEW "AlarmSourceFollowUp" AS
SELECT a.id AS "alarmId", o."followUpId"
FROM "OperationalAlarm" a JOIN "OperationalSourceFollowUp" o
  ON o.id=a."sourceId" AND o.kind=lower(a."sourceEntity")
WHERE a."sourceEntity" IN ('Task','Alert','FollowUp');

CREATE OR REPLACE VIEW "AuditSourceFollowUp" AS
WITH refs AS (
 SELECT id AS "auditLogId", entity AS kind, "entityId" AS "sourceId" FROM "AuditLog"
 UNION
 SELECT id, "after"->>'sourceEntity', "after"->>'sourceEntityId'
 FROM "AuditLog" WHERE entity='FrontiProactiveSignal'
), comment_origins AS (
 SELECT c.id, o."followUpId" FROM "Comment" c JOIN "OperationalSourceFollowUp" o
 ON (o.kind='task' AND o.id=c."taskId") OR (o.kind='alert' AND o.id=c."alertId")
   OR (o.kind='followup' AND o.id=c."followUpId")
)
SELECT r."auditLogId", o."followUpId" FROM refs r JOIN "OperationalSourceFollowUp" o
 ON o.kind=lower(r.kind) AND o.id=r."sourceId" WHERE r.kind IN ('Task','Alert','FollowUp')
UNION
SELECT r."auditLogId", c."followUpId" FROM refs r JOIN comment_origins c ON r.kind='Comment' AND r."sourceId"=c.id
UNION
SELECT r."auditLogId", a."followUpId" FROM refs r JOIN "AlarmSourceFollowUp" a ON r.kind='OperationalAlarm' AND r."sourceId"=a."alarmId"
UNION
SELECT r."auditLogId", a."followUpId" FROM refs r JOIN "OperationalAlarmRecipient" recipient ON r.kind='OperationalAlarmRecipient' AND r."sourceId"=recipient.id
 JOIN "AlarmSourceFollowUp" a ON a."alarmId"=recipient."alarmId";

CREATE VIEW "NotificationSourceFollowUp" AS
SELECT n.id AS "notificationId", o."followUpId"
FROM "Notification" n JOIN "OperationalSourceFollowUp" o
  ON o.id=n."entityId" AND o.kind=lower(n.entity)
WHERE n.entity IN ('Task','Alert','FollowUp')
UNION
SELECT n.id, a."followUpId" FROM "Notification" n JOIN "AlarmSourceFollowUp" a
  ON n.entity='OperationalAlarm' AND a."alarmId"=n."entityId"
UNION
SELECT n.id, a."followUpId" FROM "Notification" n JOIN "OperationalAlarmRecipient" r
  ON n.entity='OperationalAlarmRecipient' AND r.id=n."entityId"
  JOIN "AlarmSourceFollowUp" a ON a."alarmId"=r."alarmId"
UNION
SELECT n.id, a."followUpId" FROM "Notification" n JOIN "AuditLog" audit
  ON n.entity='FrontiProactiveSignal' AND audit.entity=n.entity AND audit."entityId"=n."entityId"
  JOIN "AuditSourceFollowUp" a ON a."auditLogId"=audit.id;
