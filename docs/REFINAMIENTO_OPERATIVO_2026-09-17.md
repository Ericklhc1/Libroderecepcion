# Refinamiento operativo · 17/09/2026

Esta iteración parte de la versión de Producción posterior a la auditoría integral del PR #36. Su objetivo no es reconstruir módulos, sino corregir fricciones de operación real detectadas al usar el Libro con informes FNSRooms reales.

## Identidad y reconciliación PMS

1. `ReservationReference.code` representa el ID exacto de FNSRooms y es la identidad canónica de una reserva. El nombre nunca identifica una reserva.
2. Un ID puede ser multihabitación. Por tanto, el ID es único como reserva, pero una ocupación física concreta conserva su identidad por ID + habitación + segmento/estado operativo.
3. Un mismo ID y habitación puede contener una salida histórica y una nueva entrada/extensión el mismo día. Para decidir el estado actual se usa la evidencia más vigente y específica de los informes, no la mera presencia histórica de un `CHECK_OUT`.
4. Las cargas PMS son incrementales e idempotentes. Cada nueva carga se cruza con lo persistido y clasifica filas como nuevas, sin cambios o modificadas. Los archivos pueden desecharse; los datos normalizados no.
5. Prioridad de evidencia operativa: In-house/actividad con estado realizado u ocupado > entrada pendiente > salida pendiente/histórica, tomando fecha de operación y segmento actual. Salidas enriquece nombres y cierre histórico; no puede borrar una extensión posterior del mismo ID.

## Caja y cierre

1. Caja se cierra antes de enviar/recibir el relevo. Al confirmar la recepción, el turno saliente se cierra automáticamente; no existe un segundo cierre manual operativo.
2. Conteos CLP/USD, diferencias, egresos, ingresos, garantías en efectivo y elementos físicos pertenecen a Caja. La entrega de turno consume el resultado del cierre de Caja; no vuelve a pedir el mismo conteo.
3. Ingreso/egreso es vocabulario reservado a movimientos que cambian el efectivo esperado de Caja. Otros montos del Libro son informativos.
4. Todo ajuste, ingreso o egreso manual que no sea movimiento automático de una garantía requiere autorización de Supervisor. La solicitud debe verse inmediatamente en Supervisión y en notificaciones.
5. Si una auditoría difiere del esperado, un Supervisor decide si sólo registra la diferencia o si acepta el contado como nuevo disponible. La decisión queda auditada.
6. Garantía significa garantía por daños de habitación/textiles. Una garantía en efectivo vive en Caja hasta devolución/aplicación/cierre, aunque atraviese turnos. Si continúa abierta después del check-out, se genera alerta crítica e incidencia.
7. Los elementos físicos se seleccionan desde catálogo. Declarar ninguno exige justificación y revisión de Supervisor, pero no impide por sí sola el cierre.
8. El dólar operativo se captura como entero CLP por USD, sin control de incremento por rueda del ratón.

## Llaves y check-out

1. Confirmar check-out incluye resolución de las llaves actualmente asignadas a esa estadía.
2. Si hay una llave, se elige entre devolución y no devolución.
3. Si existen dos o más, se declara cuántas regresan. Las devueltas vuelven al inventario; las restantes quedan pendientes de devolución, con trazabilidad.
4. No se libera silenciosamente una llave no devuelta.

## Notificaciones

1. El centro de notificaciones debe poder mostrar también alertas operativas accionables.
2. Los check-outs pendientes se gestionan allí con `Resuelto` y `Posponer 30 min`; no deben dominar permanentemente las superficies operativas.
3. Las autorizaciones de Caja generan alerta de Supervisión y notificación inmediata a todos los Supervisores activos.

## Reservas y ficha transversal

1. Habitación y reserva son dos perspectivas del mismo sujeto operativo. Las acciones mutan la misma estadía/reserva canónica.
2. `/huespedes` abre cada reserva como ficha/modal centrada, con contexto de estadía, garantías, multas, movimientos y novedades.
3. `Modificar estadía` ofrece: Late checkout a las 17:00, extender N noches y check-out anticipado. Extensión y salida anticipada generan novedad informativa con `antes → después`.
4. `Cargar nueva reserva` se expone globalmente. Acepta PDF individual de FNSRooms por selector o arrastrar/soltar. Si el ID existe, no duplica; si no existe, crea la reserva y cruza habitación/fechas con inventario.

## Pases de gimnasio

1. No tienen precio ni forma de pago dentro del Libro.
2. Se emiten por habitación/estadía activa.
3. Se indica cantidad de pax; cada pax consume un folio.
4. Folio visible de cuatro dígitos, configurable. Valor inicial propuesto: `1000`; luego secuencia estricta hasta `9999`.

## Listados e informes

1. Todo listado operativo debe tener un filtro contextual.
2. Listas extensas deben paginar, cargar por tramos o contraerse; no renderizar cientos de filas verticales por defecto.
3. Supervisión puede emitir informe de pases de gimnasio y de multas por estado/envío.
4. Todo PDF nativo puede enviarse como adjunto a uno o varios destinatarios usando la configuración de correo del hotel.
