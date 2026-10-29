# Programación de bajo consumo para la demo

La configuración de `vercel.json` de la versión 1.64.2 está pensada para la demo de Central. No es la cadencia de una operación hotelera con avisos de minuto a minuto.

Los barridos de push/automatizaciones, correo pendiente y Fronti se programan en los minutos 00, 15, 30 y 45 de cada hora. La retención de Fronti sigue ejecutándose diariamente, ahora a las 06:00 UTC para coincidir con uno de esos grupos.

Esto reduce las invocaciones programadas de 1.633 a 289 al día (82,3 %), y concentra los horarios de inicio en 96 minutos distintos al día. Son cifras de programación, no una medición de consultas, costo o cómputo real: Vercel puede introducir retrasos, los trabajos tienen duración variable y el tráfico interactivo también activa la base.

## Comportamiento visible

- El envío inmediato de correo ante acciones del usuario se conserva. Los reintentos de la cola mantienen su frecuencia de quince minutos.
- Las alarmas del usuario conectado siguen revisándose mediante la ruta existente de notificaciones.
- El push en segundo plano, las automatizaciones y las escalaciones de Coordinación/Housekeeping pasan de una revisión por minuto a una por cuarto de hora. Pueden llegar hasta unos quince minutos después de vencer, más el tiempo de ejecución y cualquier demora del proveedor. No usar esta cadencia para avisos críticos con precisión de un minuto.
- Fronti conserva su frecuencia de quince minutos y la política de retención conserva su ejecución diaria. Se mantienen autenticación de cron, barreras de mantenimiento y servicios existentes.

## Activación y comprobación

La configuración sólo entra en vigor después de desplegar el commit en Vercel Production. Mantener el proyecto pausado durante la reinstalación hasta que el propietario esté listo. Esta modificación no reinicia la cuota mensual de Neon ni garantiza que el plan gratuito alcance para cualquier carga.

Al reanudar, revisar las ejecuciones de cron y el consumo de Neon durante un día representativo: comprobar pausas entre grupos cuando no hay usuarios, entrega de correo y alarmas, y ausencia de consultas externas de monitorización que mantengan activa la base. Comparar horas de cómputo, no sólo número de invocaciones.

Para volver a una operación hotelera de minuto a minuto, restaurar `* * * * *` para `/api/cron/web-push` y presupuestar el consumo correspondiente. Los demás trabajos pueden permanecer alineados.
