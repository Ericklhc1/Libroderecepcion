# Housekeeping: trabajo diario y continuidad

## Una misma operación, distinta vista por cargo

- **Mucama**: sus trabajos asignados y solicitudes propias. Puede comenzar, informar un impedimento, retomar y marcar terminado. No inspecciona ni asigna trabajo ajeno.
- **Supervisor/a de Housekeeping**: trabajo y equipo de sus áreas; asignaciones, disponibilidad declarada, inspección, correcciones, incidentes vinculados y relevo.
- **Ama de llaves**: lo anterior, más rutinas, planificación de horarios y cobertura temporal. No recibe configuración técnica, Caja ni stock privado de Recepción.
- **Recepción**: solicita atención y consulta sus solicitudes y resultados. La asignación pertenece al área que recibe.
- **Gerencia**: consulta transversal sin otorgar escritura de Housekeeping.
- **Administrador**: puede configurar y operar; la inspección propia sigue bloqueada.

El administrador selecciona el cargo de cada **cuenta existente** y su área principal o pertenencia adicional en Equipo. No se crean personas duplicadas ni se reasignan automáticamente usuarios reales durante la publicación. Los cargos nuevos están disponibles en Roles y permisos. Los roles personalizados pueden recibir permisos granulares. El permiso anterior `housekeeping.manage` se conserva para avisos históricos y permite operación del nuevo flujo dentro del área; la planificación exige `housekeeping.plan`.

## Organizar el día

1. Elegir fecha de Chile y área.
2. Revisar solicitudes y pendientes anteriores.
3. Confirmar disponibilidad del equipo. Un horario publicado muestra programación; disponibilidad no acredita asistencia ni abre turnos de Recepción.
4. Incorporar las rutinas activas mediante **Preparar rutinas**. Cada rutina se incorpora una sola vez por día. Los cambios posteriores en la rutina no alteran la instrucción de trabajos ya creados.
5. Asignar responsables con una instrucción. La carga compara minutos estimados, no acredita horas trabajadas. Una persona declarada no disponible no puede recibir nuevas asignaciones para ese día.

No se generan 89 limpiezas por la mera existencia de 89 habitaciones. Las necesidades se registran a partir de solicitudes, planificación real o una novedad vinculada. Las áreas registradas de Llaves pueden seleccionarse como zonas sin agregarlas al catálogo de habitaciones.

## Ejecutar y revisar

**Por asignar → Pendiente → En proceso → Por revisar → Terminado.**

- Sólo la persona asignada ejecuta el trabajo.
- Limpieza de habitación y revisión crítica siempre requieren inspección. En reposición y otras atenciones, la inspección puede exigirse al crear el trabajo.
- **Terminar** registra el resultado. Si requiere inspección, aún no está aprobado.
- Otra persona habilitada inspecciona y aprueba, o devuelve para corregir con una instrucción obligatoria.
- Impedimento conserva el motivo, incluso al reasignar. Retomar exige explicar por qué se puede continuar. No se puede marcar terminado mientras esté bloqueado.
- Cada transición compara la versión e incorpora autoría e historial; dos ventanas no pueden modificar la misma versión.

Una edición de la novedad de origen después de comenzar exige revisión del supervisor. Si el trabajo esperaba inspección, aceptar la nueva instrucción vuelve a pendiente y requiere ejecutar la nueva versión.

## Solicitudes y Mantenimiento

Se puede vincular una novedad abierta a una atención; conserva su folio de origen y no copia su contenido. El resultado de Housekeeping se muestra en la novedad, pero no la cierra automáticamente.

Un impedimento puede generar una incidencia en Mantenimiento, vinculada al mismo trabajo, con habitación, prioridad, motivo y folio global. Se evita crear una segunda incidencia en un reintento. La incidencia conserva su propio responsable y cierre; enviar una solicitud no acredita reparación ni desbloquea automáticamente el trabajo.

Los avisos anteriores permanecen consultables. **Organizar trabajo** incorpora un aviso operativo pendiente al circuito diario, conservando su folio e historial y registrando el cambio de organización. Las pruebas administrativas no se convierten en operación.

## Llaves y relevo

El área consulta entregas de llaves todavía abiertas y sus destinos. Sólo aparecen las llaves efectivamente entregadas, nunca una reserva privada. La gestión de entrega/devolución usa el módulo de Llaves y sus permisos existentes.

**Dejar relevo** guarda instrucciones y una fotografía de pendientes y llaves en custodia. Otra persona habilitada confirma recepción. Recibir el relevo no termina trabajos, devuelve llaves, abre Caja ni acredita asistencia. Los trabajos mantienen continuidad hasta resolverse o cancelarse con motivo.

## Cobertura temporal y Fronti

El ama de llaves o administrador puede delegar asignación o inspección a un usuario del área por hasta 31 días. Requiere función, inicio, término y motivo; es revocable. No amplía áreas ni concede permisos técnicos, planificación o inspección propia.

Fronti consulta el mismo alcance del usuario, fechas de Chile, impedimentos, resultados y carga estimada. La sugerencia de distribución usa disponibilidad confirmada y carga estimada; cada asignación debe revisarse y confirmarse en el módulo. No utiliza un proveedor externo para inventar personal o disponibilidad, y no aprueba trabajo, escribe estados ni lee reservas privadas.

## Verificación

La migración es aditiva: amplía HousekeepingRequest, agrega rutinas, disponibilidad, relevos y delegaciones, registra permisos y cargos. No cambia usuarios reales, habitaciones, ocupación, Caja ni datos del PMS. Integración y migración deben probarse en PostgreSQL efímero de Compuerta, nunca Neon Production.
