# Centro de Supervisión

## Principio rector

Supervisión no es un módulo paralelo al Libro. Es una capa transversal de
control: los procesos reales de Recepción producen información y sólo las
excepciones que merecen atención desembocan en el Centro.

La fuente de verdad siempre permanece en su origen:

- Novedades e incidencias siguen siendo `OperationalEntry`.
- Caja conserva arqueos, garantías y movimientos.
- Turnos conserva entregas, cierres y validaciones.
- Llaves conserva sus conteos físicos por piso.
- `Task` y `FollowUp` conservan acciones y continuidad.

Supervisión observa, decide, sigue, delega o valida; no crea una segunda copia
de la realidad operativa.

## Supervisor único y continuidad

En la operación actual existe un único Supervisor de Recepción. Por eso el
turno de Supervisión no se entrega a otro supervisor.

`SupervisionShift` marca únicamente cuándo el Supervisor está ejerciendo su
jornada administrativa. El flujo normal es `ACTIVO → CERRADO`.

Las tareas y seguimientos abiertos tienen vida propia y sobreviven al cierre
del turno. Al iniciar una jornada nueva reaparecen en **Mi continuidad** sin
recrearse, reasignarse ni duplicarse.

Los modelos y datos históricos de `SupervisionShiftHandover` se conservan por
trazabilidad y compatibilidad, pero ya no forman parte del flujo normal de la
interfaz.

## El río de información

`getSupervisionData()` proyecta señales desde distintos brazos del Libro:

- incidencias críticas y asuntos sin responsable;
- alertas operativas;
- garantías y diferencias vigentes del último arqueo por divisa;
- tareas y seguimientos vencidos;
- entregas/cierres de Turnos que requieren revisión;
- último inventario de Llaves por piso cuando presenta faltantes.

Cada señal incluye la referencia del objeto real que la produjo. El botón
**Seguir** crea un `FollowUp` personal de Supervisión con
`sourceEntity + sourceId`. La relación no copia el objeto y se deduplica:
seguir dos veces la misma fuente devuelve el mismo seguimiento abierto.

Cuando existe una FK específica, se conserva además: una Novedad usa
`entryId` y una Tarea usa `taskId`.

## Inicio de turno

El Centro muestra un brief **Desde tu último turno** calculado desde el último
`SupervisionShift` cerrado. Resume actividad nueva en Novedades, cambios en
tareas y seguimientos propios, arqueos, entregas de Recepción e inventarios de
Llaves.

El brief es informativo; no convierte automáticamente cada evento en una
obligación del Supervisor.

## Capas de la pantalla

- **Ahora:** señales vivas que llegan desde los procesos del Libro.
- **Siguiendo:** objetos que el Supervisor decidió vigilar.
- **Mis pendientes:** acciones cuyo responsable es el Supervisor.
- **Desde tu último turno:** cambios ocurridos desde el último cierre.

Los tableros de auditorías, asignación y rendimiento siguen siendo vistas
especializadas de las mismas entidades, no bases de datos independientes.

## Cierre del turno

Cerrar Supervisión no exige resolver todos los pendientes. El cierre termina
la jornada administrativa y queda auditado. Las tareas y seguimientos abiertos
continúan exactamente con su estado real.

## Auditoría y permisos

Sólo el rol `SUPERVISOR` opera el turno y las acciones de Supervisión. El
Administrador de sistema conserva acceso técnico/auditado, pero no figura como
responsable operativo.

Las decisiones y cambios relevantes continúan registrándose en `AuditLog`.
Recepción no depende de que exista un turno de Supervisión abierto para
realizar su propio trabajo.

## Regla de evolución

Cualquier nuevo brazo del Libro puede alimentar Supervisión si cumple tres
condiciones:

1. existe una fuente de verdad operativa;
2. puede definirse objetivamente cuándo merece atención;
3. la resolución vuelve a la fuente original.

Nunca se debe crear una tabla paralela sólo para copiar Novedades, Caja,
Turnos, Llaves u otro dominio.
