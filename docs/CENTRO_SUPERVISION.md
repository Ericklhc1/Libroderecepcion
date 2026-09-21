# Centro de Supervisión — implementación en curso

Base de trabajo: main 878202b (v1.1.6). Propuesta v1.2.0; no es una versión publicada.

Se reutilizan Task y la bandeja getSupervisionData. Se añaden turnos independientes,
entregas con snapshot, notas con versiones reservadas, auditorías sorpresa,
medidas correctivas vinculadas a Task y observaciones de rendimiento.

La migración es aditiva. Un índice parcial impide dos turnos de Supervisión
abiertos por usuario; un trigger impide modificar entregas enviadas. El código
no escribe en turnos de Recepción. Las notas privadas no entran en el Libro,
los snapshots compartidos ni los payloads de auditoría técnica. El acceso técnico
excepcional exige motivo y escribe auditoría dentro de la transacción.

Las tareas nuevas con criterio de cumplimiento usan Realizada y Validada como
estados diferentes. COMPLETADA permanece por compatibilidad con datos previos.
Los indicadores muestran fórmula, casos y contexto, sin puntuación global.

## Pendientes de cierre: no promover esta rama todavía

- Completar la interfaz de edición, resolución, publicación explícita y
  transferencia de seguimientos; exposición de versiones y recuperación.
- Completar asignación a equipo y turno, relaciones con reservas/huéspedes y
  navegación inversa entre hallazgos, tareas y seguimientos.
- Aplicar filtros de prioridad, periodo y origen a todas las colecciones.
- Completar edición de plantillas, validación de auditorías, divulgación por
  punto/persona y lectura técnica excepcional de auditorías reservadas.
- Mostrar íntegramente el snapshot de entrega con sus actuaciones y pendientes.
- Completar interfaz de observaciones de rendimiento y fuentes verificadas,
  correcciones históricas, ausencias, carga y periodos no comparables.
- Revisar concurrencia de estados de tareas, auditorías y evidencia; reforzar
  límites de acceso a todas las acciones heredadas para tareas supervisadas.
- Revisar conversión de fechas datetime-local a America/Santiago.
- Ejecutar todas las pruebas sobre PostgreSQL desechable y corregir regresiones.
- Verificar navegación autenticada en teléfono y ordenador.
- Sólo tras resolver lo anterior: integrar, migrar Neon, desplegar y verificar
  directamente Production. No se ha hecho ninguna de esas operaciones.
