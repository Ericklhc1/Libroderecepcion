-- Additive opaque boundary for the existing source-specific traversal. PostgreSQL
-- must not inline the recursive graph into each nested permission/count predicate.
-- ROWS is an estimate, never a limit; all ancestors and historical cycles remain.
-- Existing functions, views and history are unchanged.
CREATE FUNCTION "bounded_native_entry_origin_ids"(root_kind text, root_id text)
RETURNS TABLE("entryId" text)
LANGUAGE plpgsql STABLE ROWS 16 AS $$
BEGIN
  RETURN QUERY SELECT origin."entryId" FROM "native_entry_origin_ids"(root_kind,root_id) origin;
END;
$$;
CREATE VIEW "BoundedTaskSourceEntry" AS SELECT record.id AS "taskId",origin."entryId" FROM "Task" record CROSS JOIN LATERAL "bounded_native_entry_origin_ids"('task',record.id) origin;
CREATE VIEW "BoundedAlertSourceEntry" AS SELECT record.id AS "alertId",origin."entryId" FROM "Alert" record CROSS JOIN LATERAL "bounded_native_entry_origin_ids"('alert',record.id) origin;
CREATE VIEW "BoundedFollowUpSourceEntry" AS SELECT record.id AS "followUpId",origin."entryId" FROM "FollowUp" record CROSS JOIN LATERAL "bounded_native_entry_origin_ids"('followup',record.id) origin;
CREATE VIEW "BoundedAlarmSourceEntry" AS SELECT record.id AS "alarmId",origin."entryId" FROM "OperationalAlarm" record CROSS JOIN LATERAL "bounded_native_entry_origin_ids"('operationalalarm',record.id) origin;
CREATE VIEW "BoundedAuditSourceEntry" AS SELECT record.id AS "auditLogId",origin."entryId" FROM "AuditLog" record CROSS JOIN LATERAL "bounded_native_entry_origin_ids"('auditlog',record.id) origin;
CREATE VIEW "BoundedNotificationSourceEntry" AS SELECT record.id AS "notificationId",origin."entryId" FROM "Notification" record CROSS JOIN LATERAL "bounded_native_entry_origin_ids"('notification',record.id) origin;
