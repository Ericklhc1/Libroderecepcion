# AROH Central IA · mapa canónico de información

Estado base revisado: AROH 1.60.0, commit `284424522d9fc2a8dc4c6632972dadf5b12bd88d`.

## Objetivo

Evitar que una misma realidad operativa parezca vivir en varios módulos. La regla es:

> Un dato se registra y modifica en su fuente de verdad. Las demás pantallas pueden proyectarlo, coordinarlo, supervisarlo o enlazarlo, pero no crear una copia para ganar visibilidad.

Este documento no migra ni reescribe historial. Las rutas especializadas existentes permanecen disponibles mientras tengan funciones propias o consumidores activos.

## Modelo común de un asunto

Cuando aplique, un asunto debe poder responder:

1. qué ocurrió;
2. dónde o a qué habitación/área afecta;
3. quién es responsable;
4. quién confirmó recepción;
5. cuál es la siguiente acción;
6. qué plazo existe;
7. qué impedimento apareció;
8. cuál fue el resultado;
9. quién validó o cerró.

Los registros históricos que no tengan alguno de estos datos no se rellenan por inferencia. Se conservan como evidencia y se completan sólo mediante una acción humana autorizada cuando siga siendo operacionalmente útil.

## Asignación por tipo de información

| Información | Fuente de verdad | Vistas/proyecciones válidas | Regla |
|---|---|---|---|
| Novedad / hecho operativo | Novedades · OperationalEntry | Coordinación, Mi jornada, Habitación, Supervisión, Gerencia | Registrar una vez. |
| Incidencia | Novedades · OperationalEntry tipo INCIDENCIA | Coordinación, Supervisión, Gerencia | Es un tipo de asunto, no un módulo independiente. |
| Tarea | Task / detalle de tarea | Coordinación, Novedades si está vinculada, Mi jornada | Trabajo ejecutable; no duplica el hecho que la originó. |
| Seguimiento | FollowUp | Coordinación, Supervisión, Avisos | Continuidad/recordatorio de gestión; no reemplaza el origen. |
| Alerta / recordatorio | Alert | Avisos | Llamada de atención programada; no crea una segunda tarea. |
| Notificación | Notification | Avisos | Sólo informa y enlaza al objeto original. Leer no resuelve. |
| Responsable, recepción y siguiente acción | Objeto de trabajo correspondiente | Coordinación | Coordinación organiza el ciclo, no se convierte en una base paralela. |
| Contexto por habitación | Objetos de origen + catálogo de habitaciones | Novedades / habitación | Monitor transversal, nunca PMS ni nueva fuente de datos. |
| Garantías | Caja | Habitación, Supervisión/Gerencia cuando corresponda | Caja es fuente financiera. |
| Movimientos de dinero | Caja | Supervisión/Gerencia | Nunca reconstruirlos desde Novedades. |
| Arqueos y diferencias | Caja | Turno, Supervisión, Gerencia | La diferencia permanece visible; no se maquilla el historial. |
| Gimnasio / estacionamiento | Caja | Habitación como reflejo temporal | La ficha de habitación enlaza al folio de Caja. |
| Estado, recepción, entrega y cierre de turno | Mi turno | Supervisión, Auditoría | Turno formal de Recepción; no equivale al horario laboral. |
| Horarios, cobertura y extras | Equipo y horarios | Coordinación cuando aporta contexto | Horario publicado no acredita asistencia ni abre un turno operativo. |
| Llaves de habitaciones | Llaves | Turno/Supervisión como señal | Inventario y custodia física propios. |
| Stock, textiles y materiales | Inventario | Lavandería y áreas autorizadas | Una sola existencia; mover custodia no crea stock paralelo. |
| Folios de lavandería | Lavandería sobre Inventario | Inventario | Reutiliza la misma fuente de existencias. |
| Trabajo de Housekeeping | Housekeeping | Coordinación, Habitación cuando esté vinculado | Ejecución e inspección permanecen en HK. |
| Derivación a Mantención | Incidencia/tarea vinculada al origen | Coordinación | No crear otra incidencia al reintentar o escalar. |
| Auditorías de jefatura | Centro de Supervisión | Gerencia/Auditoría según permiso | Control sobre fuentes reales, no copias. |
| Indicadores de jefatura | Supervisión / Gerencia calculados | — | Derivados de datos operativos; no editar manualmente el resultado. |
| Evidencia de cambios | Auditoría | Enlaces desde módulos | Inmutable; una corrección agrega evidencia nueva. |
| Usuarios, roles, permisos y parámetros | Administración | — | Configuración, no operación. |
| Asistencia contextual y propuestas IA | Fronti | Transversal | Puede explicar/proponer; la fuente sigue siendo el servicio real. |
| Ayuda y tutoriales | Ayuda / tutorial | Transversal | Deben describir el modelo vigente, no versiones históricas. |

## Qué significa cada superficie

### Mi jornada
Entrada por rol. Resume lo que requiere atención y lleva al origen correcto. No es fuente de verdad.

### Coordinación
Bandeja común para priorizar, asignar, confirmar recepción, dejar siguiente acción y revisar resultados entre áreas. Debe enlazar siempre al objeto que realmente se ejecuta o resuelve.

### Novedades
Registro de hechos y asuntos operativos. Incidencia es una clasificación dentro de este dominio.

### Tareas y Seguimientos
Se conservan como objetos con reglas propias y como vistas especializadas. No deben presentarse como módulos raíz independientes.

### Avisos
Agrupa notificaciones y recordatorios. Una notificación sólo avisa; una alerta/recordatorio programa atención. Ninguna de las dos reemplaza el asunto original.

### Novedades / habitación
Contextualiza la operación de una habitación mediante enlaces a objetos reales. No gestiona ocupación, check-in, check-out ni estadías.

### Supervisión y Gerencia
Leen, priorizan, controlan y deciden sobre evidencia producida por la operación. No deben duplicar la información operativa para conservarla.

## Tratamiento de información heredada

Clasificación recomendada:

- **Completa:** puede proyectarse directamente en el modelo vigente.
- **Utilizable/incompleta:** conserva valor, pero falta uno o más datos de coordinación (área, responsable, siguiente acción, plazo, etc.).
- **Histórica:** cerrada; se conserva sin exigir completar contexto que ya no tiene valor operativo.
- **Ambigua:** no se reasigna automáticamente porque podría cambiar el significado del registro.

Nunca se inventan responsable, habitación, área, plazo, resultado ni relación causal para completar datos antiguos.

## Redundancias que se corrigen primero

1. Tareas, incidencias y seguimientos dejan de describirse como destinos equivalentes a módulos raíz.
2. Las vistas especializadas deben explicar que sirven para consulta/gestión específica y enlazar a Coordinación para la visión conjunta.
3. Novedades / habitación debe seguir mostrando reflejos y enlaces, no permitir que esos reflejos compitan con Caja, Tareas o Seguimientos como fuente.
4. Avisos debe mantener separadas las nociones de notificación, recordatorio y pendiente.
5. Supervisión y Gerencia deben señalar siempre evidencia y origen antes de permitir una decisión.

## Fuera de este bloque

- No se elimina ninguna tabla, ruta ni registro histórico.
- No se hace backfill masivo.
- No se fusionan Task, FollowUp, Alert u OperationalEntry en una sola tabla.
- No se cambia FNSrooms ni se amplía AROH hacia funciones PMS.
- No se construye todavía el Tutorial Maestro de Jefaturas.
