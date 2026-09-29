-- Aviso interno privado solicitado para @EHerrera.
-- Se inserta directamente en Notification para que permanezca sólo en el Libro
-- y no pase por el despachador de correo externo.
INSERT INTO "Notification" (
  "id",
  "userId",
  "type",
  "title",
  "body",
  "link",
  "entity",
  "entityId",
  "createdAt",
  "isDemo"
)
SELECT
  'release-note-1-26-0-eherrera',
  u."id",
  'ACTUALIZACION_OPERATIVA'::"NotificationType",
  'Libro 1.26.0 · mejoras publicadas',
  '• Supervisión: apertura operativa obligatoria con revisión de pendientes, arqueo propio, garantías, llaves e informes antes de activar el turno.\n• Ventas por período: sustituye Ventas por canal, estructura centros de coste y detecta cortesías, cobertura parcial e incoherencias sin duplicar el mes.\n• Conciliación: cruces entre Ventas por período, auditoría, Producción por habitación, In House, movimientos PMS, inventario activo y multas por blancos.\n• Fronti proactivo: cada 5 min revisa si cambió el conjunto de señales; sólo si cambió usa IA para agruparlas en focos probables y generar un briefing.\n• Seguridad IA: Fronti no modifica datos, no cambia severidades y no ejecuta acciones; la decisión sigue siendo humana.\n• Vercel Pro: se aprovecha para el cron frecuente y mayor margen operativo sin revertir las optimizaciones de CPU.',
  '/supervision',
  'ReleaseNote',
  '1.26.0',
  NOW(),
  FALSE
FROM "User" u
WHERE LOWER(u."username") = 'eherrera'
  AND u."active" = TRUE
  AND u."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Notification" n
    WHERE n."userId" = u."id"
      AND n."entity" = 'ReleaseNote'
      AND n."entityId" = '1.26.0'
  )
ON CONFLICT ("id") DO NOTHING;
