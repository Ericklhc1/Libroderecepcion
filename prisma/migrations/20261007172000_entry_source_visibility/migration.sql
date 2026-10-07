-- Additive, read-only provenance of the existing Task/Alert/FollowUp source graph.
-- No historical writes, no alternate workflow. UNION terminates historical cycles.
CREATE VIEW "OperationalSourceEntry" AS
WITH RECURSIVE edges(kind,id,parent_kind,parent_id) AS (
 SELECT 'task'::text,id,'alert'::text,"alertId" FROM "Task" WHERE "alertId" IS NOT NULL
 UNION ALL SELECT 'alert',id,'task',"taskId" FROM "Alert" WHERE "taskId" IS NOT NULL
 UNION ALL SELECT 'task',id,'followup',"followUpId" FROM "Task" WHERE "followUpId" IS NOT NULL
 UNION ALL SELECT 'alert',id,'followup',"followUpId" FROM "Alert" WHERE "followUpId" IS NOT NULL
 UNION ALL SELECT 'followup',id,'task',"taskId" FROM "FollowUp" WHERE "taskId" IS NOT NULL
 UNION ALL SELECT 'followup',id,lower("sourceEntity"),"sourceId" FROM "FollowUp"
 WHERE "sourceEntity" IN ('Task','Alert','FollowUp') AND "sourceId" IS NOT NULL
), origins(kind,id,"entryId") AS (
 SELECT 'task'::text,id,"entryId" FROM "Task" WHERE "entryId" IS NOT NULL
 UNION SELECT 'alert',id,"entryId" FROM "Alert" WHERE "entryId" IS NOT NULL
 UNION SELECT 'followup',id,"entryId" FROM "FollowUp" WHERE "entryId" IS NOT NULL
 UNION SELECT 'followup',id,"sourceId" FROM "FollowUp" WHERE "sourceEntity"='OperationalEntry' AND "sourceId" IS NOT NULL
 UNION SELECT e.kind,e.id,o."entryId" FROM edges e JOIN origins o ON e.parent_kind=o.kind AND e.parent_id=o.id
) SELECT kind,id,"entryId" FROM origins;
CREATE VIEW "TaskSourceEntry" AS SELECT id AS "taskId","entryId" FROM "OperationalSourceEntry" WHERE kind='task';
CREATE VIEW "AlertSourceEntry" AS SELECT id AS "alertId","entryId" FROM "OperationalSourceEntry" WHERE kind='alert';
CREATE VIEW "FollowUpSourceEntry" AS SELECT id AS "followUpId","entryId" FROM "OperationalSourceEntry" WHERE kind='followup';
