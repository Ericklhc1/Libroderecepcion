-- Los pases de gimnasio pasan a ser folios informativos de cuatro dígitos.
-- El primer folio nuevo definido para la operación es 1000.
DO $$
DECLARE
  v_last BIGINT;
BEGIN
  SELECT last_value INTO v_last FROM "gym_pass_folio_seq";
  IF v_last < 999 THEN
    PERFORM setval('"gym_pass_folio_seq"'::regclass, 999, true);
  END IF;
END $$;
