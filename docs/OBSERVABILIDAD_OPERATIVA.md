# Observabilidad operativa P0 + P1 + P2

Fecha de introducción: 26/09/2026  
Versión P2: **v1.14.0**  
Alcance: **medir procesos críticos y estabilidad técnica sin modificar su lógica**.

## Propósito

La observabilidad operativa responde cuánto tardan los flujos, dónde fallan y
qué procesos quedan iniciados sin cierre. No es un sistema de vigilancia de
personas, no puntúa recepcionistas y no sustituye a Auditoría.

La fuente es `OperationalMetricEvent`. Los datos canónicos siguen viviendo en
Turnos, Entregas, Caja, Libro, Llaves, Fronti y demás modelos existentes.

## Arquitectura

- Escritura central: `src/server/observability/operational.ts`.
- Persistencia: PostgreSQL/Neon mediante Prisma.
- Escritura diferida con `after()`: la respuesta de la operación principal no
  espera el INSERT de telemetría.
- Todo error al programar o persistir una métrica se captura y no se propaga.
- P0, P1 y P2 reutilizan la misma tabla; **P2 no añade migraciones**.
- `metadata` usa una lista cerrada de claves pequeñas y estructuradas.
- No se guardan nombres, correos, contraseñas, preguntas, prompts, respuestas,
  mensajes, notas, campos de formulario, argumentos/resultados de tools,
  importes, denominaciones ni snapshots operativos.
- `userId` puede existir en eventos técnicos que ya nacen asociados a un
  usuario, pero `/supervision/salud` no agrupa, compara ni ordena personas.

## Correlación

El cierre saliente usa:

`shift-close:<shiftId>`

La recepción entrante usa:

`handover-receive:<handoverId>`

Fronti usa un identificador aleatorio por ejecución:

`fronti:<uuid>`

Los procesos que cruzan varias operaciones reutilizan el mismo
`correlationId` para relacionar inicio y resultado sin duplicar contenido
operativo.

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

`CASH_COUNT_COMPLETED` guarda únicamente metadata estructurada como
`countKind` y `hasDifference`; no duplica importes ni líneas de Caja.

## Eventos P1

P1 reutiliza exactamente la misma tabla y el mismo servicio central.

| Flujo | Eventos | Qué permite medir |
|---|---|---|
| Libro | `ENTRY_CREATED`, `ENTRY_TAKEN`, `ENTRY_RESOLVED` | tiempo hasta tomar y resolver sin copiar contenido |
| Inventario de llaves | `KEY_INVENTORY_STARTED`, `KEY_INVENTORY_COMPLETED`, `KEY_INVENTORY_WITH_DIFFERENCES` | duración real desde la primera interacción y frecuencia de diferencias |
| Tutorial | `TUTORIAL_STARTED`, `TUTORIAL_STEP_REACHED`, `TUTORIAL_CLOSED_THIS_SESSION`, `TUTORIAL_DISABLED`, `TUTORIAL_COMPLETED` | avance, abandono explícito y finalización |

El inventario usa un `correlationId` por intento. El tutorial registra sólo el
ID estructurado del paso alcanzado; nunca copia contenido escrito o visible.

## Eventos P2

P2 cierra la observabilidad técnica prevista para esta iniciativa.

| Área | Evento | Semántica |
|---|---|---|
| Fronti | `FRONTI_REQUEST` | una ejecución del agente fue iniciada |
| Fronti | `FRONTI_SUCCESS` | la ejecución terminó con outcome `success` o `partial` |
| Fronti | `FRONTI_FAILURE` | la ejecución terminó en `error` o límite de loops |
| Fronti | `FRONTI_TOOL_CALLED` | una tool fue ejecutada; sólo nombre y éxito/fallo |
| Server Actions | `ACTION_FAILED` | error inesperado atrapado por `runAction`; excluye validaciones y errores de dominio esperados |
| Server Actions | `ACTION_TIMEOUT` | la acción terminó después del umbral técnico de 20 s |

### Fronti

El colector central vive en `src/server/ai/fronti-v2/telemetry.ts`. Conserva
el log técnico existente y ahora persiste únicamente:

- proveedor/modelo final;
- proveedor/modelo configurado;
- duración;
- número de loops;
- cantidad de tools;
- éxito/fallo de cada tool;
- outcome;
- tipo de fallo técnico;
- indicador de fallback.

`fallbackUsed` significa que el proveedor o modelo final difirió de la
configuración primaria. Es una señal operacional, no una valoración de calidad.

No se persisten prompts, mensajes, respuestas, memoria, argumentos de tools ni
resultados de tools.

### Fallos técnicos transversales

`runAction` registra `ACTION_FAILED` únicamente en el camino de error
inesperado que ya alimentaba el diagnóstico técnico. Por diseño **no cuenta**
como fallo una validación de Zod, `ValidationError`, `AppError`, conflicto
de unicidad manejado o redirect de Next.js.

`ACTION_TIMEOUT` se emite cuando una acción completa supera 20.000 ms. Ese
valor es un **umbral técnico de observación**, no un objetivo, SLA ni criterio
de productividad. La acción mantiene su resultado normal aunque haya cruzado
el umbral.

## Datos derivados

No se persisten promedios, percentiles ni objetivos. El servicio
`src/server/services/operational-health.ts` calcula al consultar:

- cantidad por evento;
- duración promedio;
- mediana;
- P90;
- cierres iniciados sin final correlacionado;
- arqueos con diferencias;
- éxito observado de Fronti;
- latencia media/mediana/P90 de Fronti;
- ejecuciones Fronti con fallback;
- tools ejecutadas y tools con fallo;
- errores inesperados de Server Actions;
- acciones que cruzaron el umbral técnico.

## Panel

Ruta: `/supervision/salud`.

Permiso: `supervision.center.view`, ya existente.

Rangos: Hoy, 7 días y 30 días.

La pantalla identifica los valores como **datos observados**. No contiene
objetivos, puntuaciones individuales ni rankings.

## Deliberadamente fuera

No se instrumentan:

- navegación general;
- clicks generales;
- heatmaps;
- movimiento del usuario;
- contenido de formularios;
- contenido de Fronti;
- reapertura de Caja como flujo específico;
- rankings o comparaciones por persona.

Cualquier ampliación futura debe justificar qué decisión operacional habilita y
mantener el principio de mínima captura.

## Retención

No se implementa borrado automático en esta etapa. La tabla sólo recibe eventos
estructurados pequeños.

Política a decidir después de una línea base suficiente:

1. medir volumen real y crecimiento;
2. definir retención acorde al volumen;
3. antes de cualquier purga, definir exportación/archivo y aprobación
   administrativa;
4. nunca ejecutar purgas junto con una operación hotelera.

## Migración e índices

Única migración de esta iniciativa:
`20260926160000_operational_observability_p0`.

Índices:

- `(eventType, createdAt)`;
- `createdAt`;
- `(userId, createdAt)`;
- `(shiftId, createdAt)`;
- `(correlationId, createdAt)`.

P1 y P2 reutilizan tabla e índices; no necesitan migración.

## Regla de operación

Si falla la observabilidad, falla **sólo la observabilidad**. Turnos, Caja,
entregas, Libro, Llaves, Fronti y recepción continúan por sus reglas actuales.
