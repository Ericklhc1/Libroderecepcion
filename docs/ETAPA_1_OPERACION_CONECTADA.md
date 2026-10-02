# Etapa 1 · Operación conectada (PR, sin publicación)

## Recorridos

- **Operación → Coordinación** reúne novedades/incidencias con sus tareas y seguimientos autorizados, tareas independientes y trabajo de Housekeeping. Cada tarjeta enlaza al registro original. Una atención HK sustituye la tarjeta del registro vinculado cuando el lector puede verla; el origen sigue enlazado para registrar su cierre.
- Filtrar por área permite elegir un **usuario existente**, registrar siguiente acción y reasignar. La recepción anterior se invalida y se solicita confirmación al nuevo responsable. El horario publicado se muestra únicamente dentro del alcance de Equipo del lector y no acredita asistencia; horas y descansos no cambian.
- El responsable confirma **recepción** y después atiende/resuelve desde el registro original. La recepción no inicia ni resuelve el trabajo. La ejecución, validación, evidencia y permisos de cierre siguen en los servicios nativos. No se cierran tareas, seguimientos ni novedades en cascada por aceptar una tarjeta.
- Un pendiente sigue accesible después del turno de origen. La nueva asignación conserva instrucciones y auditoría. Entrega/recepción de Caja y llaves siguen sus recorridos nativos y no se generan movimientos desde Coordinación.
- Housekeeping añade **Confirmar recepción** antes de comenzar. Comenzar directamente conserva compatibilidad y registra recepción/inicio en la misma acción. El relevo diferencia **entregado → recibido → continuidad aceptada**; sólo quien recibió puede aceptar, sin cerrar ni reasignar automáticamente sus trabajos.
- Un impedimento derivado a Mantenimiento exige gravedad. Incidencia, tarea, seguimiento y vínculo al trabajo original se guardan en una transacción. La tarea técnica queda por asignar; el creador conserva el seguimiento de coordinación. El resultado de Mantenimiento se consulta mediante el vínculo original; no se crea otra incidencia al reintentar.
- Gerencia, Supervisión y Equipo incluyen acceso a la bandeja común. Las cuentas de HK mantienen sólo su alcance de área; las proyecciones de tareas y seguimientos respetan privados por creador, reservados por permiso y operativos por creador/asignado/gestor.

## Medición y aviso pendiente

Los nuevos campos en Task y OperationalEntry guardan asignación, recepción, primer inicio, siguiente acción y marca de escalamiento, sin copiar contenido operativo ni inventar eventos históricos. Housekeeping reutiliza sus marcas actuales.

La bandeja muestra totales filtrados y estadísticas **de la página visible** con denominador: confirmación, espera hasta inicio y resolución. Los tiempos sin datos aparecen como «—»; no se presentan como cero. La paginación trae hasta 25 asuntos por origen, con sus vínculos limitados a 20; el detalle original permite consultar el resto.

Las nuevas asignaciones pendientes de recepción durante 30 minutos desde la disponibilidad programada se escalan una vez al creador/coordinador mediante el cron existente. Reasignar reinicia el ciclo. La bandeja permanece consultable aunque falle push o no corra el cron. Los registros anteriores sin marca de asignación no reciben un plazo histórico inventado. Este umbral está centralizado en `RECEIPT_MINUTES`.

## Arquitectura y controles

- Migración aditiva `20261002093000_operacion_conectada`, sin backfill ni cambios de roles/datos reales.
- Escrituras de Coordinación bloquean la fila original, verifican revisión y autorización, conservan una clave de reintento con hash de contenido y guardan auditoría/participación en la misma transacción. El reintento exacto no duplica efectos; clave reutilizada con otro contenido se rechaza.
- La asignación desde pantallas nativas invalida la recepción anterior. No se añaden permisos de Caja, llaves privadas, administración o IA.
- Dependencias concretas de auditoría: autenticación fail-closed de cron (H08), política de privacidad para las nuevas proyecciones (parte de H01), creación/continuidad atómica de Mantenimiento desde HK (H04/H05 en esa ruta). Esto **no cierra** el resto de los hallazgos de auditoría.
- Coordinar no requiere proveedor de IA. El catálogo de contexto registra la pantalla sin añadir herramientas de automatización de etapas 2/3.

## Verificación

Pruebas de integración en `tests/coordination.test.ts`: recorrido de recepción a resolución, acceso rechazado, privacidad derivada, reasignación, reintento concurrente, conflicto entre revisiones, continuidad entre turnos, escalamiento, HK y aceptación de relevo, contrato de Mantenimiento y horario limitado por permiso.

Compuerta ejecuta PostgreSQL 16 desechable, migraciones, lint, tipos, suite completa y build. Después prepara sesiones sintéticas con aceptación legal y reproduce asignar → recibir → resolver desde el registro original en Chromium de escritorio y viewport móvil. Comprueba acceso restringido y ausencia de desbordamiento horizontal. Las conexiones se restringen a la base sintética de CI y HTTP a loopback; las sesiones no se publican como artefactos. El artefacto conserva sólo resultados.

La barra reducida y las transiciones ya existían en v1.45.0: se conservan y se comprueban con las regresiones de navegación, grupos, foco y movimiento reducido. No se duplica su implementación.

## Antes de una eventual publicación

Revisar CI del último commit y reconciliar los PR H01/H08 si se incorporan antes. Confirmar CRON_SECRET para Production; sin ello los cron se rechazan. Aplicar la migración únicamente en una publicación autorizada. Reversión del código compatible conservando los campos aditivos y su historial; no eliminar columnas ni restaurar datos por defecto.

Continúan fuera de este PR la idempotencia financiera, los restantes lectores H01, la concurrencia general de Novedades y la investigación de entrega push en dispositivos reales. No se afirma resolución del incidente de la reunión ni aceptación móvil en Safari/iOS físico.
