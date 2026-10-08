# Recepción · impresión y revisión del cierre (1.64.0)

La entrega utiliza los mismos registros de turno, Caja y custodia. La impresión tiene una presentación propia A4 horizontal, márgenes de 9 mm (12 mm inferiores para el pie), Arial 8 pt, negro y encabezados grises. El pie indica «Imprimir a doble cara · horizontal» y cuenta páginas. La persona debe seleccionar el dúplex en el diálogo de impresión; CSS no controla la impresora.

`HandoverPrint` presenta Caja declarada/confirmada, garantías fotografiadas al contar, elementos, tablas de novedades/alertas ordenadas URG/IMP/INF y firmas de 24 mm. No muestra tareas, acciones de Supervisión, chat, Fronti ni controles interactivos. Los contadores se calculan sobre los ítems impresos; un repetido se presenta con ×N y conserva su cantidad. No se recorta el texto nuevo para reducir páginas. Para una entrega enviada se puede imprimir también sin receptor confirmado.

`tests/handover-print.test.tsx` genera PDFs reales con Chromium y cuenta sus páginas con pdf.js. La fixture reproduce los 11 avisos, la alerta de diferencia, las tres garantías y los cuatro elementos del modelo aprobado del 02-10, con nombres sintéticos. Comprueba A4 horizontal, máximo dos páginas, todos los folios, fechas, firmas, texto del pie y su numeración. Incluye las variantes enviada y recibida. No consulta datos del hotel. Si una fotografía histórica no contiene garantías, se indica que no está disponible; nunca se sustituye por las garantías actuales. Si faltaba la fecha objetivo en una fotografía de garantías antigua, se muestra —; no se inventa desde el registro actual.

## Acción de Supervisión

El trigger existente `shift_closure_validation` conserva su identidad. La migración nueva `20261007160000_reception_handover_print` reemplaza únicamente su función `create_shift_closure_validation`: al entrar en CERRADO registra `closureReviewRequestedAt` en el mismo Shift y una auditoría obligatoria en la misma transacción. No crea Alert, Task u OperationalEntry.

El Centro proyecta esos turnos como acciones pendientes con folio, fecha y tipo de turno. `/supervision/cierres/[id]` abre ese cierre y ofrece Validar/Observar, con evidencia obligatoria, permiso shift.manage, rol Supervisor/Administrador y revisión optimista. Observar mantiene el pendiente, incluso si el turno se archiva; archivar no sustituye la revisión. Validar lo retira de la bandeja. Ambas decisiones quedan auditadas. Las señales históricas soft-deleted no habilitan un formulario de revisión ni acreditan una validación.

Las alertas y tareas históricas no se eliminan ni migran. Las alertas abiertas antiguas permiten proyectar la acción del turno correspondiente, sin duplicarla en Alertas críticas vivas. Las vistas operativas de recepción y la entrega/impresión excluyen esas señales. Las alertas conservan su estado y sus registros de auditoría. Los enlaces de diferencias van al relevo o al arqueo concreto; las garantías tienen una ficha del mismo registro, con los formularios y servicios de Caja existentes. Crear seguimiento explica su efecto y exige confirmación.

## Alcance de novedades

La visibilidad configurable por área y la exclusión individual de entrega se retiraron del PR #279 por instrucción del propietario. No hay controles, acciones, filtros, bloqueos ni pruebas de esa función. Las novedades operativas se leen como antes, incluidas las creadas por Supervisión. El modelo futuro de un área relacionada se trabajará en el bloque UI/UX; esta versión no lo implementa.

Se conserva la reserva existente de tareas y seguimientos privados y de sus derivados, independiente de las novedades por área. Las tareas y validaciones de Supervisión no forman parte de la impresión de Recepción.

## Migración y reversión

Las migraciones aditivas ya escritas se conservan intactas. Las columnas y relación de áreas ocultas, vistas de procedencia de novedades y campos de invalidación/huella de revisión quedan sin uso por la aplicación. No hay backfill ni reparación de datos del hotel. La excepción al límite aditivo fue autorizada expresamente para CREATE OR REPLACE de la función; las migraciones anteriores quedan intactas.

La descripción del PR incluye el SQL completo para restaurar la función anterior. La reversión conserva columnas, relación, solicitudes nuevas e historial; no elimina evidencia. Debe acompañarse de la reversión del código de la release por el flujo de despliegue existente. Las alertas históricas nunca son material de limpieza automática.
