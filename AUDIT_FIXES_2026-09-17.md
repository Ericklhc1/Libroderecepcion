# Depuración integral 2026-09-17

Estado de salida de la pasada de consolidación:

- una sola ruta canónica de importación PMS: `/huespedes/importar`;
- autorización de Supervisión coherente entre navegación y servidor;
- ciclo de turno sin cierre directo desde `ACTIVO`;
- sincronización PMS autoritativa para estado, fechas y habitación de la reserva, usando el ID exacto como identidad;
- datos personales enriquecidos en Recepción se conservan cuando el PMS sólo aporta una representación menos completa;
- endpoint canónico de Fronti consolidado;
- matriz de permisos del código y de la base alineada mediante migración;
- Caja configurable y validaciones de egresos/entrega consolidadas;
- revisión posterior de cierres preparada mediante alerta auditada;
- pruebas antiguas actualizadas únicamente donde contradecían las reglas operativas consolidadas.

## Verificación previa a promoción

La pasada funcional alcanzó Compuerta verde con lint, TypeScript, regresiones y build correctos. El Preview de Vercel quedó READY y la base Preview de Neon recibió las migraciones nuevas; se verificaron la matriz de permisos y el trigger de validación posterior del cierre.

Antes de promocionar Producción se creó el snapshot de seguridad Neon `snap-steep-base-acewwx3p` sobre la rama `production`.

## Criterio de salida

No se considera cerrada la auditoría sólo porque compile. Para promover deben coincidir: HEAD de GitHub, Compuerta verde, Preview READY y migraciones verificadas. Después del merge se comprueban nuevamente deployment de producción, migraciones aplicadas y ausencia de errores críticos de runtime.
