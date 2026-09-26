# Observabilidad operativa P0

Fecha de introducción: 26/09/2026  
Alcance: **medir procesos críticos sin modificar su lógica**.

## Propósito

La observabilidad operativa responde cuánto tardan los flujos, dónde fallan y
qué procesos quedan iniciados sin cierre. No es un sistema de vigilancia de
personas, no puntúa recepcionistas y no sustituye a Auditoría.

La fuente nueva es `OperationalMetricEvent`. Los datos canónicos siguen
viviendo en Turnos, Entregas, Caja, Novedades y demás modelos existentes.

## Arquitectura

- Escritura central: `src/server/observability/operational.ts`.
- Persistencia: PostgreSQL/Neon mediante Prisma.
- Escritura diferida con `after()`: la respuesta de la acción principal no
  espera el INSERT de telemetría.
- Todo error al programar o persistir una métrica se captura y no se propaga.
- `metadata` sólo admite claves pequeñas de una lista cerrada:
  `shiftType`, `mode`, `countKind`, `hasDifference`, `failureType`.
- No se guardan nombres, correos, contraseñas, preguntas, notas, mensajes,
  importes, denominaciones ni snapshots operativos.
- `userId` existe sólo para diagnóstico técnico autorizado; el panel general
  no presenta comparaciones entre personas.

## Correlación

El cierre usa un identificador estable:

`shift-close:<shiftId>`

Bajo esa correlación se observan inicio del cierre, arqueo, cierre formal de
Caja, envío de entrega y cierre final. La duración total se calcula al cerrar
el turno contra el último `SHIFT_CLOSE_STARTED` de esa correlación.

Las operaciones que duran una sola petición conservan además su propia
duración `durationMs`.

## Eventos P0

| Flujo | Inicio | Éxito | Fallo |
|---|---|---|---|
| Inicio normal de turno | `SHIFT_START_REQUESTED` | `SHIFT_STARTED` | `SHIFT_START_FAILED` |
| Continuidad/contingencia | `SHIFT_CONTINGENCY_STARTED` | `SHIFT_CONTINGENCY_COMPLETED` | `SHIFT_CONTINGENCY_FAILED` |
| Recepción de entrega | `HANDOVER_RECEIVE_STARTED` | `HANDOVER_RECEIVED` | `HANDOVER_RECEIVE_FAILED` |
| Cierre completo de turno | `SHIFT_CLOSE_STARTED` | `SHIFT_CLOSE_COMPLETED` | `SHIFT_CLOSE_FAILED` |
| Arqueo | `CASH_COUNT_STARTED` | `CASH_COUNT_COMPLETED` | `CASH_COUNT_FAILED` |
| Cierre formal de Caja | `CASH_CLOSE_STARTED` | `CASH_CLOSED` | `CASH_CLOSE_FAILED` |
| Envío de entrega | `HANDOVER_SEND_STARTED` | `HANDOVER_SENT` | `HANDOVER_SEND_FAILED` |

`CASH_COUNT_COMPLETED` guarda sólo `countKind` y `hasDifference`. No
duplica importes ni líneas de Caja.

## Datos derivados

No se persisten promedios ni objetivos. El servicio
`src/server/services/operational-health.ts` calcula sobre eventos reales:

- cantidad por evento;
- duración promedio;
- mediana;
- P90;
- fallos;
- cierres iniciados que aún no tienen final correlacionado;
- arqueos con/sin diferencia.

Novedades creadas y resueltas se calculan desde `OperationalEntry.createdAt`
y `closedAt`; no se duplican como eventos P0.

## Panel

Ruta: `/supervision/salud`.

Permiso: `supervision.center.view`, ya existente. No se crea ni modifica
ningún permiso.

Rangos: Hoy, 7 días y 30 días.

La pantalla identifica los valores como **datos observados**. No contiene
objetivos, puntuaciones individuales ni rankings.

## Deliberadamente fuera de P0

No se instrumentan todavía:

- `ENTRY_CREATED`, `ENTRY_TAKEN`, `ENTRY_RESOLVED`: los timestamps
  existentes cubren la primera línea base sin duplicar datos;
- inventario de llaves;
- tutorial;
- Fronti persistente: hoy conserva telemetría técnica en logs;
- `ACTION_FAILED` / `ACTION_TIMEOUT` genéricos de interfaz;
- navegación general;
- reapertura de Caja;
- heatmaps, clics o movimiento de usuario.

Estos puntos pertenecen a P1/P2 y requieren un ciclo posterior.

## Retención

No se implementa borrado automático en esta etapa. La tabla sólo recibe
eventos P0 pequeños.

Política propuesta para decidir después de la línea base de 30 días:

1. medir volumen real y crecimiento;
2. conservar inicialmente hasta 12 meses en línea si el volumen sigue siendo
   bajo;
3. antes de cualquier purga, definir exportación/archivo y aprobación
   administrativa;
4. nunca ejecutar purgas junto con una operación hotelera.

## Migración e índices

Migración: `20260926160000_operational_observability_p0`.

Índices mínimos:

- `(eventType, createdAt)`;
- `createdAt`;
- `(userId, createdAt)`;
- `(shiftId, createdAt)`;
- `(correlationId, createdAt)`.

La migración sólo crea tabla e índices. No modifica ni elimina datos existentes.

## Regla de operación

Si falla la observabilidad, falla **sólo la observabilidad**. Turnos, Caja,
entregas y recepción continúan por sus reglas actuales.
