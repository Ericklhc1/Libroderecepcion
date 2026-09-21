# Centro de Supervisión

## Propósito

El Centro de Supervisión complementa el Libro Operativo sin sustituir ni
controlar el turno de Recepción. Reutiliza la bandeja de Supervisión, `Task`,
`FollowUp`, las listas de control y `AuditLog`; no mantiene una segunda fuente
de novedades operativas.

Rutas principales:

- `/supervision`: turno, prioridades, pendientes, notas y resumen del equipo.
- `/supervision/tablero`: asignación operativa existente.
- `/supervision/auditorias`: plantillas, auditorías sorpresa, hallazgos y
  medidas correctivas.
- `/supervision/rendimiento`: indicadores separados, fórmulas, contexto y
  registros de origen.

## Límites de rol

- Sólo el rol `SUPERVISOR` puede operar turnos de Supervisión, auditorías,
  medidas correctivas y observaciones de rendimiento.
- El Administrador de sistema conserva consulta técnica y auditoría, pero los
  servicios impiden que figure como supervisor, auditor, asignado,
  colaborador o destinatario operativo.
- `listOperationalUsers()` y `assertAssignable()` son las barreras comunes de
  todos los selectores y escrituras de asignación.
- Recepción no tiene permisos del Centro ni acceso a indicadores del equipo.

## Turno independiente

`SupervisionShift` mantiene el ciclo `ACTIVO → ENTREGADO → CERRADO`. Una
restricción parcial en PostgreSQL impide dos turnos abiertos para el mismo
Supervisor, pero permite turnos simultáneos de personas diferentes.

No existe relación de control con `Shift`: iniciar, entregar o cerrar
Supervisión no modifica caja, huéspedes, llaves, habitaciones ni el turno de
Recepción. La entrega crea un `SupervisionShiftHandover.snapshot` JSON
inalterable con tareas, seguimientos, decisiones auditadas, auditorías y
medidas existentes en ese momento. Otro Supervisor confirma la recepción sin
alterar esa copia.

## Tareas y seguimientos

`Task` conserva compatibilidad con el estado histórico `COMPLETADA` e incorpora
`ACEPTADA`, `REALIZADA`, `DEVUELTA` y `VALIDADA`. Marcar una tarea como
realizada nunca la valida. La devolución exige motivo; la realización exige la
evidencia declarada; toda transición se audita.

`TaskAssignment` representa responsable principal y colaboradores. Una tarea
puede dirigirse a una persona, varias, un turno activo, el equipo operativo o
el propio Supervisor. Las relaciones opcionales con habitación, reserva,
huésped, estadía, registro, incidencia, seguimiento, alerta, área y turno usan
las entidades existentes.

Los seguimientos autónomos sólo se crean durante un turno de Supervisión. Su
visibilidad es privada, de Supervisión u operativa y se conserva en la entrega.

## Privacidad

`SupervisionNote` separa notas del Libro y de los antecedentes formales. Una
nota `PRIVADO` sólo aparece al autor. El Administrador únicamente puede abrirla
mediante la función de acceso técnico excepcional, que crea un registro de
auditoría específico. Las bajas son lógicas y restaurables.

## Auditorías sorpresa

El módulo amplía `ChecklistTemplate`, `ChecklistRun` y `ChecklistRunItem`.
Al iniciar se copian los puntos de la plantilla, preservando el texto revisado
aunque la plantilla cambie después. La auditoría empieza en preparación
reservada y no crea notificaciones previas.

Cada punto admite `CUMPLE`, `OBSERVACION`, `INCUMPLIMIENTO` o `NO_APLICA`, más
evidencia. Los hallazgos se confirman al cerrar. El Supervisor decide la
divulgación y puede convertir un hallazgo en `CorrectiveMeasure`; ésta crea una
tarea relacionada que también necesita realización y validación separadas.

## Rendimiento explicable

Los indicadores se calculan desde tareas, seguimientos, turnos, auditorías,
hallazgos, medidas y colaboraciones. No se persiste una nota global ni se
construye una clasificación. Cada dimensión devuelve periodo, numerador,
denominador, fórmula, fuente y enlaces a los casos; además muestra turnos,
carga y límites de comparabilidad.

No se usan tiempo conectado, pulsaciones, volumen bruto ni penalizaciones por
una incidencia aislada. `PerformanceObservation` guarda por separado una
observación manual, una explicación del trabajador o una corrección posterior.

## Migración y recuperación

La migración `20260921170000_centro_supervision` es aditiva: añade enums,
tablas, columnas, índices y claves foráneas. Migra los responsables actuales a
`TaskAssignment` sin modificar tareas existentes y conserva los estados
históricos de tareas y listas de control.

Tareas, seguimientos, notas, plantillas, auditorías, hallazgos, medidas y
observaciones incluyen o reutilizan eliminación lógica. La recuperación queda
auditada y reservada al Administrador de sistema.

## Verificación

La prueba `tests/centro-supervision.test.ts` cubre roles, turnos simultáneos,
independencia de Recepción, asignación múltiple, devolución y validación,
privacidad, entrega inalterable, auditorías, medidas, recuperación e
indicadores explicables. La Compuerta ejecuta migraciones sobre PostgreSQL
efímero y después lint, tipos, todas las pruebas y el build de producción.
