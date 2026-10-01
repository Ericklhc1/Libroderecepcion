# Informe preliminar — Housekeeping en AROH Central IA

> Actualización 1.40.0: por instrucción posterior, el módulo pasa a ser habilitable por permisos y el administrador participa en la operación. Este informe conserva el alcance preliminar del piloto 1.39.0; las pruebas anteriores siguen identificadas.

Fecha: 01/10/2026. Base revisada: GitHub main `2381ecd4`, versión 1.38.0.
Informe entregado antes de comenzar la implementación.

## Conclusión y alcance

Implementar una bandeja privada de coordinación de Housekeeping: aviso → recepción → gestión → resultado. Recepción sigue siendo el punto de partida de la coordinación hotelera. No se construyen reservas, tarifas, disponibilidad comercial, asignación de habitaciones ni cambios de ocupación.

Primera fase exclusivamente para el rol Administrador de sistema, incluyendo URL directa, navegación, lectura y escritura. Las confirmaciones se identifican como pruebas administrativas. El administrador no aparece como personal operativo ni se incorpora a turnos/asignaciones.

## Riesgos y controles

| Riesgo | Control previsto |
|---|---|
| Duplicar novedades | Vínculo único al registro original; contenido consultado desde su fuente. |
| Confundir recepción con cumplimiento | Estados, fechas y movimientos diferentes para recepción y resultado. |
| Confirmar instrucciones incompletas | «Necesito aclaración» mantiene el pendiente sin fabricar recepción. |
| Cambiar instrucciones después de confirmar | Detectar versión nueva y exigir reconfirmación antes de continuar. |
| Silenciar un pendiente con un toque | Confirmar no resuelve; el pendiente conserva gestión y plazo. |
| Perder pendientes entre días/turnos | Sin cierre automático por fecha; resolución o cancelación justificadas. |
| Acceso de otros perfiles con permisos técnicos | Restricción al rol canónico administrador en página, acciones y servicios. |
| Doble clic / ventanas concurrentes | Clave de reintento única, vínculo único y control de versión transaccional. |
| Falsa atribución de trabajo al personal | Indicador de piloto y auditoría como prueba; sin notificaciones externas ni asignaciones. |
| Borrar el contexto original | Se conserva el historial; un origen archivado exige revisar/cancelar. |

## Coherencia operativa y razonamiento humano

La pantalla responde qué necesita Housekeeping, qué está sin confirmar, qué impide avanzar y qué resultado se registró. Solo ofrece acciones válidas para la fase actual. La recepción declara lectura/entendimiento de una versión específica; no acredita comprensión real ni trabajo físico. En este piloto acredita únicamente una simulación administrativa.

Bloquear exige motivo. Resolver exige resultado. Cancelar/reabrir exige motivo. Reabrir reinicia la recepción, conservando el historial previo. Un impedimento se retoma antes de resolver.

## Reducción de redundancia

- Vincular una novedad evita transcribir título, descripción y habitación.
- Confirmar recepción requiere un toque; historial, fecha y actor son automáticos.
- Descripción breve solo al crear un aviso manual; motivo solo para una excepción o resultado.
- Habitación/zona y vencimiento opcionales: áreas comunes siguen siendo atendibles.
- No se crean automáticamente una novedad, tarea, seguimiento y alerta por cada aviso.
- Se reutilizan identidad, autenticación, catálogo de prioridad, hora Chile, # global, componentes y auditoría existentes.

## Límites deliberados de esta fase

Los registros específicos del piloto necesitan persistencia separada para no contaminar tareas, indicadores ni bandejas del personal. Una novedad real puede consultarse como origen, pero el piloto no cambia su estado. No hay envío a empleados, push, escalamiento automático, planificación de horarios ni integración PMS. La persistencia se demuestra en la bandeja; no equivale a alarmas continuas fuera de la aplicación.

Antes de abrirlo al personal: definir responsable/suplente por turno, horario de cobertura del área, compromiso de atención, reglas de escalamiento y quién valida resultados. La IA puede asistir en resúmenes; las decisiones y confirmaciones siguen siendo humanas.

## Criterios de aceptación

1. Ningún otro rol puede consultar ni modificar Housekeeping, aunque tenga permisos técnicos.
2. Aviso, recepción y resultado sobreviven a recargas y tienen evidencias distintas.
3. Reintentos y vínculos concurrentes no duplican registros.
4. Dos actualizaciones de una misma versión no pueden ambas prosperar.
5. Cambiar la fuente obliga a revisar la nueva versión antes de continuar.
6. No se crean tareas, asignaciones ni notificaciones para el personal.
7. Migración aditiva verificada con PostgreSQL desechable en la Compuerta; producción no se usa para pruebas.
