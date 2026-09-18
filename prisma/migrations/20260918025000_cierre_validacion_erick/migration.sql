-- Consolida la validación posterior obligatoria del cierre.
-- Cada turno que pasa a CERRADO genera/recupera su alerta de validación y,
-- cuando existe @EHerrera, una tarea de prioridad ALTA asignada a él.

CREATE OR REPLACE FUNCTION "create_shift_closure_validation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  validation_alert_id text;
  validator_id text;
  creator_id text;
BEGIN
  IF NEW."status" = 'CERRADO'::"ShiftStatus"
     AND OLD."status" IS DISTINCT FROM NEW."status" THEN

    SELECT u."id"
      INTO validator_id
      FROM "User" u
     WHERE lower(u."username") = lower('EHerrera')
       AND u."active" = true
       AND u."deletedAt" IS NULL
     ORDER BY u."createdAt" ASC
     LIMIT 1;

    creator_id := COALESCE(NEW."closedById", NEW."startedById", NEW."createdById", validator_id);

    INSERT INTO "Alert" (
      "id",
      "type",
      "level",
      "title",
      "message",
      "status",
      "dedupeKey",
      "auto",
      "createdAt",
      "updatedAt",
      "isDemo"
    ) VALUES (
      gen_random_uuid()::text,
      'OTRO'::"AlertType",
      'CRITICA'::"AlertLevel",
      'Validar cierre de turno',
      'Revisión posterior obligatoria asignada a Erick Herrera. Comprueba informes, caja, elementos y trazabilidad antes de validarlo.',
      'NUEVA'::"AlertStatus",
      'shift-validation:' || NEW."id",
      false,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      NEW."isDemo"
    )
    ON CONFLICT ("dedupeKey") DO UPDATE
      SET "message" = EXCLUDED."message",
          "updatedAt" = CURRENT_TIMESTAMP,
          "deletedAt" = NULL
    RETURNING "id" INTO validation_alert_id;

    IF validator_id IS NOT NULL
       AND creator_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM "Task" t
          WHERE t."alertId" = validation_alert_id
            AND t."deletedAt" IS NULL
       ) THEN
      INSERT INTO "Task" (
        "id",
        "title",
        "description",
        "status",
        "priority",
        "origin",
        "assigneeId",
        "createdById",
        "shiftId",
        "alertId",
        "tags",
        "createdAt",
        "updatedAt",
        "isDemo"
      ) VALUES (
        gen_random_uuid()::text,
        'Validar cierre de turno',
        'Revisión posterior obligatoria del cierre. Validar o devolver para corrección con observación.',
        'PENDIENTE'::"TaskStatus",
        'ALTA'::"Priority",
        'ALERTA'::"TaskOrigin",
        validator_id,
        creator_id,
        NEW."id",
        validation_alert_id,
        ARRAY['cierre','validacion-jefatura']::text[],
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        NEW."isDemo"
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "shift_closure_validation" ON "Shift";
CREATE TRIGGER "shift_closure_validation"
AFTER UPDATE OF "status" ON "Shift"
FOR EACH ROW
EXECUTE FUNCTION "create_shift_closure_validation"();

-- Backfill de cierres ya existentes: conserva la alerta existente y crea una
-- tarea asignada a Erick Herrera si todavía no existe.
WITH validator AS (
  SELECT u."id"
    FROM "User" u
   WHERE lower(u."username") = lower('EHerrera')
     AND u."active" = true
     AND u."deletedAt" IS NULL
   ORDER BY u."createdAt" ASC
   LIMIT 1
),
existing_validation AS (
  SELECT
    a."id" AS alert_id,
    s."id" AS shift_id,
    s."closedById",
    s."startedById",
    s."createdById",
    s."isDemo",
    (SELECT "id" FROM validator) AS validator_id
  FROM "Shift" s
  JOIN "Alert" a
    ON a."dedupeKey" = 'shift-validation:' || s."id"
  WHERE s."status" = 'CERRADO'::"ShiftStatus"
    AND s."archivedAt" IS NULL
    AND a."deletedAt" IS NULL
)
INSERT INTO "Task" (
  "id",
  "title",
  "description",
  "status",
  "priority",
  "origin",
  "assigneeId",
  "createdById",
  "shiftId",
  "alertId",
  "tags",
  "createdAt",
  "updatedAt",
  "isDemo"
)
SELECT
  gen_random_uuid()::text,
  'Validar cierre de turno',
  'Revisión posterior obligatoria del cierre. Validar o devolver para corrección con observación.',
  'PENDIENTE'::"TaskStatus",
  'ALTA'::"Priority",
  'ALERTA'::"TaskOrigin",
  ev.validator_id,
  COALESCE(ev."closedById", ev."startedById", ev."createdById", ev.validator_id),
  ev.shift_id,
  ev.alert_id,
  ARRAY['cierre','validacion-jefatura']::text[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  ev."isDemo"
FROM existing_validation ev
WHERE ev.validator_id IS NOT NULL
  AND COALESCE(ev."closedById", ev."startedById", ev."createdById", ev.validator_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM "Task" t
     WHERE t."alertId" = ev.alert_id
       AND t."deletedAt" IS NULL
  );
