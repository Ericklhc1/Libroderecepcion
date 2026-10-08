-- Additive read-only projection of existing native source links. No history writes.
-- UNION handles historical cycles; prior views/migrations remain unchanged.
CREATE VIEW "NativeEntryProvenance" AS
WITH RECURSIVE edges(kind,id,parent_kind,parent_id) AS (
 SELECT 'task'::text,id,'alert'::text,"alertId" FROM "Task" WHERE "alertId" IS NOT NULL
 UNION ALL SELECT 'alert',id,'task',"taskId" FROM "Alert" WHERE "taskId" IS NOT NULL
 UNION ALL SELECT 'task',id,'followup',"followUpId" FROM "Task" WHERE "followUpId" IS NOT NULL
 UNION ALL SELECT 'alert',id,'followup',"followUpId" FROM "Alert" WHERE "followUpId" IS NOT NULL
 UNION ALL SELECT 'task',id,'operationalentry',"entryId" FROM "Task" WHERE "entryId" IS NOT NULL
 UNION ALL SELECT 'alert',id,'operationalentry',"entryId" FROM "Alert" WHERE "entryId" IS NOT NULL
 UNION ALL SELECT 'followup',id,'operationalentry',"entryId" FROM "FollowUp" WHERE "entryId" IS NOT NULL
 UNION ALL SELECT 'followup',id,'task',"taskId" FROM "FollowUp" WHERE "taskId" IS NOT NULL
 UNION ALL SELECT 'followup',id,lower("sourceEntity"),"sourceId" FROM "FollowUp" WHERE "sourceId" IS NOT NULL AND "sourceEntity" IS NOT NULL
 UNION ALL SELECT 'operationalalarm',id,lower("sourceEntity"),"sourceId" FROM "OperationalAlarm" WHERE "sourceId" IS NOT NULL AND "sourceEntity" IS NOT NULL
 UNION ALL SELECT 'operationalalarmrecipient',id,'operationalalarm',"alarmId" FROM "OperationalAlarmRecipient"
 UNION ALL SELECT 'comment',id,'operationalentry',"entryId" FROM "Comment" WHERE "entryId" IS NOT NULL
 UNION ALL SELECT 'comment',id,'task',"taskId" FROM "Comment" WHERE "taskId" IS NOT NULL
 UNION ALL SELECT 'comment',id,'alert',"alertId" FROM "Comment" WHERE "alertId" IS NOT NULL
 UNION ALL SELECT 'comment',id,'followup',"followUpId" FROM "Comment" WHERE "followUpId" IS NOT NULL
 UNION ALL SELECT 'comment',id,'comment',"parentId" FROM "Comment" WHERE "parentId" IS NOT NULL
 UNION ALL SELECT 'housekeepingrequest',id,'operationalentry',"sourceEntryId" FROM "HousekeepingRequest" WHERE "sourceEntryId" IS NOT NULL
 UNION ALL SELECT 'housekeepingrequest',id,'operationalentry',"maintenanceEntryId" FROM "HousekeepingRequest" WHERE "maintenanceEntryId" IS NOT NULL
 UNION ALL SELECT 'housekeepingwork',id,'housekeepingrequest',id FROM "HousekeepingRequest"
 UNION ALL SELECT 'auditlog',id,lower(entity),"entityId" FROM "AuditLog"
 UNION ALL SELECT 'auditlog',a.id,lower(j.value->>'sourceEntity'),COALESCE(j.value->>'sourceId',j.value->>'sourceEntityId') FROM "AuditLog" a CROSS JOIN LATERAL (VALUES(a."before"),(a."after")) j(value) WHERE j.value->>'sourceEntity' IS NOT NULL AND COALESCE(j.value->>'sourceId',j.value->>'sourceEntityId') IS NOT NULL
 UNION ALL SELECT 'auditlog',a.id,'operationalentry',COALESCE(j.value->>'sourceEntryId',j.value->>'entryId') FROM "AuditLog" a CROSS JOIN LATERAL (VALUES(a."before"),(a."after")) j(value) WHERE COALESCE(j.value->>'sourceEntryId',j.value->>'entryId') IS NOT NULL
 UNION ALL SELECT 'frontiproactivesignal',"entityId",'auditlog',id FROM "AuditLog" WHERE entity='FrontiProactiveSignal'
 UNION ALL SELECT 'notification',id,lower(entity),"entityId" FROM "Notification" WHERE entity IS NOT NULL AND "entityId" IS NOT NULL
), origins(kind,id,"entryId") AS (
 SELECT 'operationalentry'::text,id,id FROM "OperationalEntry"
 UNION SELECT e.kind,e.id,o."entryId" FROM edges e JOIN origins o ON e.parent_kind=o.kind AND e.parent_id=o.id
) SELECT kind,id,"entryId" FROM origins;
CREATE VIEW "NativeTaskSourceEntry" AS SELECT id AS "taskId","entryId" FROM "NativeEntryProvenance" WHERE kind='task';
CREATE VIEW "NativeAlertSourceEntry" AS SELECT id AS "alertId","entryId" FROM "NativeEntryProvenance" WHERE kind='alert';
CREATE VIEW "NativeFollowUpSourceEntry" AS SELECT id AS "followUpId","entryId" FROM "NativeEntryProvenance" WHERE kind='followup';
CREATE VIEW "NativeAlarmSourceEntry" AS SELECT id AS "alarmId","entryId" FROM "NativeEntryProvenance" WHERE kind='operationalalarm';
CREATE VIEW "NativeAuditSourceEntry" AS SELECT id AS "auditLogId","entryId" FROM "NativeEntryProvenance" WHERE kind='auditlog';
CREATE VIEW "NativeNotificationSourceEntry" AS SELECT id AS "notificationId","entryId" FROM "NativeEntryProvenance" WHERE kind='notification';
