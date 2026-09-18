UPDATE "SystemSetting"
SET "value" = '"qwen/qwen3.6-27b"'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'fronti.model'
  AND "value" = '"gpt-5.6-luna"'::jsonb;
