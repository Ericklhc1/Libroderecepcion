-- Additive, source-specific traversal. Every step looks up its requested native
-- record by primary key; unrelated audit/notification history is never a seed.
-- Older migrations/views remain intact. No backfill, cache or history writes.
CREATE FUNCTION "native_entry_origin_ids"(root_kind text, root_id text)
RETURNS TABLE("entryId" text)
LANGUAGE sql STABLE AS $$
WITH RECURSIVE walk(kind,id) AS (
  SELECT lower(root_kind),root_id
  UNION
  SELECT p.kind,p.id FROM walk w CROSS JOIN LATERAL (
    SELECT parent.kind,parent.id FROM "Task" t CROSS JOIN LATERAL (VALUES
      ('operationalentry',t."entryId"),('alert',t."alertId"),('followup',t."followUpId")
    ) parent(kind,id) WHERE w.kind='task' AND t.id=w.id
    UNION ALL SELECT parent.kind,parent.id FROM "Alert" a CROSS JOIN LATERAL (VALUES
      ('operationalentry',a."entryId"),('task',a."taskId"),('followup',a."followUpId")
    ) parent(kind,id) WHERE w.kind='alert' AND a.id=w.id
    UNION ALL SELECT parent.kind,parent.id FROM "FollowUp" f CROSS JOIN LATERAL (VALUES
      ('operationalentry',f."entryId"),('task',f."taskId"),(lower(f."sourceEntity"),f."sourceId")
    ) parent(kind,id) WHERE w.kind='followup' AND f.id=w.id
    UNION ALL SELECT lower(a."sourceEntity"),a."sourceId" FROM "OperationalAlarm" a WHERE w.kind='operationalalarm' AND a.id=w.id
    UNION ALL SELECT 'operationalalarm',r."alarmId" FROM "OperationalAlarmRecipient" r WHERE w.kind='operationalalarmrecipient' AND r.id=w.id
    UNION ALL SELECT parent.kind,parent.id FROM "Comment" c CROSS JOIN LATERAL (VALUES
      ('operationalentry',c."entryId"),('task',c."taskId"),('alert',c."alertId"),('followup',c."followUpId"),('comment',c."parentId")
    ) parent(kind,id) WHERE w.kind='comment' AND c.id=w.id
    UNION ALL SELECT parent.kind,parent.id FROM "HousekeepingRequest" h CROSS JOIN LATERAL (VALUES
      ('operationalentry',h."sourceEntryId"),('operationalentry',h."maintenanceEntryId")
    ) parent(kind,id) WHERE w.kind IN ('housekeepingrequest','housekeepingwork') AND h.id=w.id
    UNION ALL SELECT 'operationalentry',a."entryId" FROM "SubjectAreaAttention" a WHERE w.kind='subjectareaattention' AND a.id=w.id
    UNION ALL SELECT 'auditlog',a.id FROM "AuditLog" a WHERE w.kind IN ('frontiproactivesignal','subjectdistribution') AND a.entity=CASE w.kind WHEN 'frontiproactivesignal' THEN 'FrontiProactiveSignal' ELSE 'SubjectDistribution' END AND a."entityId"=w.id
    UNION ALL SELECT lower(n.entity),n."entityId" FROM "Notification" n WHERE w.kind='notification' AND n.id=w.id
    UNION ALL SELECT lower(a.entity),a."entityId" FROM "AuditLog" a WHERE w.kind='auditlog' AND a.id=w.id
    UNION ALL SELECT parent.kind,parent.id FROM "AuditLog" a CROSS JOIN LATERAL (VALUES(a."before"),(a."after")) j(value) CROSS JOIN LATERAL (VALUES
      (lower(j.value->>'sourceEntity'),COALESCE(j.value->>'sourceId',j.value->>'sourceEntityId')),
      ('operationalentry',COALESCE(j.value->>'sourceEntryId',j.value->>'entryId')),
      ('task',j.value->>'taskId'),('housekeepingrequest',j.value->>'housekeepingId')
    ) parent(kind,id) WHERE w.kind='auditlog' AND a.id=w.id
    UNION ALL SELECT 'subjectareaattention',attention.id FROM "AuditLog" a CROSS JOIN LATERAL (VALUES(a."before"),(a."after")) j(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(j.value->'attentionIds')='array' THEN j.value->'attentionIds' ELSE '[]'::jsonb END) attention(id)
      WHERE w.kind='auditlog' AND a.id=w.id
  ) p WHERE p.kind IS NOT NULL AND p.id IS NOT NULL
)
SELECT DISTINCT e.id FROM walk w JOIN "OperationalEntry" e ON e.id=w.id WHERE w.kind='operationalentry';
$$;
CREATE VIEW "ScopedTaskSourceEntry" AS SELECT t.id AS "taskId",o."entryId" FROM "Task" t CROSS JOIN LATERAL "native_entry_origin_ids"('task',t.id) o;
CREATE VIEW "ScopedAlertSourceEntry" AS SELECT a.id AS "alertId",o."entryId" FROM "Alert" a CROSS JOIN LATERAL "native_entry_origin_ids"('alert',a.id) o;
CREATE VIEW "ScopedFollowUpSourceEntry" AS SELECT f.id AS "followUpId",o."entryId" FROM "FollowUp" f CROSS JOIN LATERAL "native_entry_origin_ids"('followup',f.id) o;
CREATE VIEW "ScopedAlarmSourceEntry" AS SELECT a.id AS "alarmId",o."entryId" FROM "OperationalAlarm" a CROSS JOIN LATERAL "native_entry_origin_ids"('operationalalarm',a.id) o;
CREATE VIEW "ScopedAuditSourceEntry" AS SELECT a.id AS "auditLogId",o."entryId" FROM "AuditLog" a CROSS JOIN LATERAL "native_entry_origin_ids"('auditlog',a.id) o;
CREATE VIEW "ScopedNotificationSourceEntry" AS SELECT n.id AS "notificationId",o."entryId" FROM "Notification" n CROSS JOIN LATERAL "native_entry_origin_ids"('notification',n.id) o;
-- The source lookup also uses entity+id for legacy receipts/signals. The existing
-- native index is case-sensitive; match exact persisted entity names below.
