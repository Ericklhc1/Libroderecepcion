UPDATE "SystemSetting"
SET "value" = '"openai/gpt-oss-120b"'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'fronti.model'
  AND "value" = '"gpt-5.6-luna"'::jsonb;
