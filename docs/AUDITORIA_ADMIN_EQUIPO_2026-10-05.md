# Administración y Equipo: F11 / F14

Cambios locales de la auditoría del 5 de octubre de 2026. Sin migración, cambios de permisos, datos reales, infraestructura ni publicación.

## Semántica visible

- Administración → Áreas separa las cuentas cuya área principal coincide de las pertenencias de horarios activas. Una cuenta puede pertenecer a varias áreas. El contador de pertenencias describe la relación; no acredita que la cuenta, el perfil y el área estén habilitados.
- Administración → Usuarios muestra el área principal, las pertenencias activas/retiradas y áreas inactivas, el estado del perfil de horarios, el estado global de cuenta y el número de asignaciones vigentes/futuras, incluidos borradores.
- Cambiar área principal no modifica pertenencias; desactivar, ocultar o eliminar afecta globalmente la cuenta. Retirar sólo una pertenencia se realiza en Equipo → Colaboradores.
- El selector conserva un área principal que se haya desactivado, para que una edición de otro campo no la sustituya involuntariamente.

## Guardas canónicas

`src/server/services/schedule-admin-safety.ts` contiene las transacciones administrativas y el predicado compartido `ongoingOrFutureScheduleSlots`.

Se consideran vigentes/futuras las asignaciones no canceladas cuyo `endAt` aún no pasa, además de descansos/ausencias sin hora correspondientes a hoy o después en la zona del hotel. Esto incluye los turnos de la noche anterior que siguen en curso. Los registros ya terminados y los cancelados no bloquean.

Desactivar una cuenta activa, ocultar una cuenta visible, cambiar a un rol no operativo o eliminar lógicamente exige que no quede programación vigente/futura en ninguna área, publicada o borrador. Desactivar un área exige lo mismo para sus mallas. El bloqueo pide cancelar/reasignar las asignaciones futuras desde Equipo y esperar que terminen las jornadas en curso. No cambia ni cancela asignaciones por debajo del formulario.

Cuenta, revocación de sesiones y auditoría comparten transacción. Se mantienen los permisos independientes `user.manage`, `role.manage` y `system.configure`, la revisión autorizada de Fronti, el impedimento de eliminarse a sí mismo y la preservación del último administrador activo.

## Concurrencia

Orden de bloqueos compatible con el catálogo: User `FOR NO KEY UPDATE` → Department destino → ScheduleCollaborator. Las mutaciones de horarios mantienen Department → ScheduleCollaborator; el bloqueo de User permite los `KEY SHARE` de las claves foráneas de auditoría. El área se bloquea antes de comprobar su programación.

Los cambios administrativos de cuenta se serializan mediante un advisory transaccional para impedir que dos bajas concurrentes eliminen al último administrador. La verificación y escritura de elegibilidad están protegidas por el mismo bloqueo de colaborador que las nuevas asignaciones. El alta/vínculo de un perfil aún inexistente comparte el bloqueo de User con el catálogo.

## Verificación

- Lint focal aprobado en las tres interfaces, la acción, el servicio y ambos archivos de pruebas.
- `tests/schedule-admin-ui.test.tsx`: 5 pruebas SSR aprobadas con datos, autorización y acciones simuladas. Comprueban contadores, impactos, búsqueda por pertenencia, ausencia de perfil y preservación del área principal inactiva. No sustituyen una prueba de navegador.
- `tests/schedule-admin-safety.test.ts`: 18 pruebas aprobadas en PostgreSQL sintético y desechable. Incluyen bloqueos, rollback, noche vigente, ausencias, historia, pertenencias, permisos/revisión, concurrencia y último administrador. Las fixtures iniciales que violaban las restricciones de estado se corrigieron usando los servicios nativos; no se relajaron restricciones ni aserciones.
- No se ejecutaron build ni typecheck global por coordinación de memoria. La integración, el navegador y Compuerta del SHA final deben verificarse antes de publicar.

## Revisión de integración

Se reprodujo una inversión de locks entre el lector de suplencias (User SHARE → Department SHARE) y los escritores nuevos. Tres pruebas PostgreSQL con barreras reproducían `40P01` en catálogo, retiro de pertenencia y administración. Los escritores se alinearon a User NO KEY UPDATE → Department → Collaborator; se mantiene compatibilidad con FK KEY SHARE y no se relajan validación ni permisos. Las tres pruebas completan ambas transacciones sin reintento. Repetición conjunta aprobada: 99 pruebas entre seguridad administrativa (18), suplencias (38) y horarios (43).
