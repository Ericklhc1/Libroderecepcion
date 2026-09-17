-- Todo cierre operativo debe dejar una revisión pendiente para Supervisión.
-- La alerta es la bandeja de validación ya existente; su resolución está
-- restringida en servidor a Supervisor o Administrador de sistema.

CREATE OR REPLACE FUNCTION "create_shift_closure_validation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'CERRADO'::"ShiftStatus"
     AND OLD."status" IS DISTINCT FROM NEW."status" THEN
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
      'Revisión posterior obligatoria del cierre. Comprueba informes, caja, elementos y trazabilidad antes de validarlo.',
      'NUEVA'::"AlertStatus",
      'shift-validation:' || NEW."id",
      false,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      NEW."isDemo"
    )
    ON CONFLICT ("dedupeKey") DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "shift_closure_validation" ON "Shift";
CREATE TRIGGER "shift_closure_validation"
AFTER UPDATE OF "status" ON "Shift"
FOR EACH ROW
EXECUTE FUNCTION "create_shift_closure_validation"();

-- Los cierres ya existentes también deben quedar visibles para revisión si
-- todavía no existe una validación asociada. No modifica el turno: sólo crea
-- la tarea de revisión posterior.
INSERT INTO "Alert" (
  "id", "type", "level", "title", "message", "status", "dedupeKey",
  "auto", "createdAt", "updatedAt", "isDemo"
)
SELECT
  gen_random_uuid()::text,
  'OTRO'::"AlertType",
  'CRITICA'::"AlertLevel",
  'Validar cierre de turno',
  'Revisión posterior obligatoria del cierre histórico. Comprueba informes, caja, elementos y trazabilidad antes de validarlo.',
  'NUEVA'::"AlertStatus",
  'shift-validation:' || s."id",
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  s."isDemo"
FROM "Shift" s
WHERE s."status" = 'CERRADO'::"ShiftStatus"
  AND s."archivedAt" IS NULL
ON CONFLICT ("dedupeKey") DO NOTHING;
