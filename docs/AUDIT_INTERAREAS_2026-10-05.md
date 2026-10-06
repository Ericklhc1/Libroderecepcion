# Auditoría operativa: asuntos y atenciones por área

Implementación local sobre 1.58.1 y el candidato de navegación. No publicada. El conjunto final deja las nuevas distribuciones apagadas por defecto; los lectores de recuperación siguen activos.

## Contrato

- Un único `OperationalEntry` conserva la necesidad original. `SubjectAreaAttention` conserva la distribución explícita a una, varias o todas las áreas disponibles, sin duplicar asuntos.
- La bandeja `/coordinacion/areas` distingue conocimiento, publicación informativa, asignación y aclaración. Tomar conocimiento no publica ni termina. La decisión y el motivo se auditan. Sólo jefatura habilitada del área, creador/dueño del origen y guardia expresamente indicada ven la revisión interna; los miembros operativos del área ven lo publicado.
- Las decisiones que requieren ejecución usan Task o HousekeepingRequest nativos. No existe otro motor de trabajo. La ejecución, resultado e inspección/validación independiente siguen sus permisos. Recepción ve los estados/resultados por área desde el asunto.
- HK y Áreas públicas pueden tener intervenciones simultáneas sobre el mismo asunto; cada una conserva responsable, inspección y eventos. Una segunda solicitud vuelve a jefatura y reabre por el servicio nativo, sin borrar la primera evidencia.
- Resolver y cerrar comparten guarda transaccional: no quedan tareas, HK, seguimientos operativos o decisiones por revisar/aclarar. La cancelación nativa motivada sigue siendo una salida. La vigilancia `SUPERVISION_*` no se vuelve una obligación de cierre.
- Los escritores que crean/reactivan trabajo se serializan con el asunto. No se crea trabajo nuevo sobre un asunto finalizado. Las incoherencias históricas continúan visibles; no se corrigen silenciosamente.
- `resolvedAt` registra resolución o cierre directo, se conserva al pasar de RESUELTO a CERRADO y se limpia al reabrir. `closedAt` conserva su significado de cierre formal. No se inventaron fechas históricas.

## Urgencia e importancia

La importancia conserva `priority`; la urgencia se solicita por separado, con riesgo concreto y guardia/suplencia elegible elegida explícitamente por área. No se infiere disponibilidad ni asistencia de un horario. Una urgencia crea el trabajo nativo y avisa inmediatamente a guardia y jefatura, sin esperar publicación. La guardia indicada puede tomar únicamente su propia asignación con su capacidad de ejecución vigente; la revisión posterior de jefatura continúa pendiente.

Los plazos del origen y las reglas de escalamiento ya existentes permanecen. No se inventaron SLA, guardias automáticas ni tiempos de escalamiento. Debe verificarse disponibilidad real de la persona indicada. No se afirma entrega efectiva del aviso ni atención física.

Las custodias de turno no se saltan: PREPARANDO_ENTREGA ofrece volver a operación mediante Mi turno → Cancelar preparación; tras envío/cierre/recepción se indica contactar directamente con guardia habilitada y completar la custodia correspondiente. No se bloquea otro módulo por una lectura, publicación o análisis de IA pendiente.

La clasificación inicial no se modifica silenciosamente al redistribuir a un área existente: un intento de cambiar urgencia o validación es rechazado explícitamente. La gestión avanzada de cobertura/criterios de urgencia sigue usando configuración y autorizaciones vigentes; no hay una política automática nueva.

## Hallazgos cubiertos

F02: secuencia pertinente de revisar resultados/seguimientos y guardas iguales para resolución/cierre. HK técnico exige resultado vigente de Mantenimiento, conservando impedimento e inspección.
F04: tarea sin persona avisa a coordinador habilitado; Mantenimiento entra a todos sus pendientes y tiene acceso visible a la bandeja de revisión.
F05: HK terminado/cancelado devuelve el asunto abierto a pendientes una sola vez.
F06: asignación general valida acceso; perfiles exclusivamente HK se encauzan a su flujo. Selectores de tarea excluyen perfiles sin acceso genérico.
F07: Coordinación avisa a saliente y entrante; resultados incluyen creador/dueño del origen. HK avisa al saliente sobre su asignación terminada sin ampliar acceso al trabajo reasignado.
F17: el asunto usa una entrada canónica de distribución, también disponible durante otra intervención abierta; retira la alternativa engañosa de tarea genérica sobre asunto cerrado. Reintentos y segunda atención conservan vínculos e historial.

## Migración y pruebas

`20261005174500_subject_area_attention` agrega bandeja y `OperationalEntry.resolvedAt`. Agrega exclusividad origen/área y un índice parcial para el vínculo histórico sin área, pero CONSERVA además el índice global de 1.58.1. El esquema Prisma ya expone lectura plural; la base sigue impidiendo multiplicidad incluso a escritores antiguos. Sólo una migración posterior autorizada podrá retirar el índice global después de verificar un artefacto de recuperación compatible. No borra datos ni rellena retrospectivamente fechas. Validada y aplicada únicamente sobre PostgreSQL sintético aislado.

140 pruebas focales aprobadas en 10 archivos: tareas, entradas, Coordinación, reserva/permisos, resultados y HK→Mantenimiento→HK. Posteriormente la batería nueva pasó con 17 casos, incluidos privacidad previa a publicación, segunda atención y cierre concurrente. Las expectativas antiguas se adaptaron a la nueva regla explícita de resolver sólo después de completar las obligaciones; no se relajó la guarda.

Pendiente antes de publicar: Compuerta integral del SHA final (tipos, build, suite completa) y recorrido navegador multirol y móvil. Este ejecutor usa lint/sintaxis y PostgreSQL focal; no se atribuye validación visual ni tipos globales. No hubo operaciones productivas, gasto, proveedor nuevo o llamadas nuevas a IA.


## Entrega compatible y activación diferida

`AROH_SUBJECT_AREA_DISTRIBUTION_ENABLED` sólo habilita las nuevas mutaciones cuando vale exactamente `true`. Ausente, vacío o cualquier otro valor mantiene apagados `distributeSubject`, `decideAreaAttention` y sus controles de UI. No se creó ni modificó una variable real. Las rutas nativas/heredadas también impiden abrir intervención simultánea de otra área y crear un segundo vínculo HK mientras está apagado.

Los lectores permanecen habilitados: asunto, bandeja con paginación/filtro, Coordinación y resultados muestran todas las intervenciones existentes, bajo sus autorizaciones. No se esconden datos multiarea al desactivar el control. El alias singular de `getEntry` se conserva sólo para consumidores antiguos; las pantallas utilizan la colección completa.

La primera entrega debe ser correctiva y de lectura compatible, con índice global y control apagado. Después de publicar/verificar un artefacto que lea todos los datos, una entrega futura podrá decidir la activación y retirar el índice global. No usar 1.58.1 como recuperación tras permitir multiplicidad. No basta activar mantenimiento para hacer compatible ese rollback.

Pruebas finales: 149 casos aprobados en 11 archivos, incluidos apagado por defecto, rechazo de escritura sin UI, índice global frente al escritor anterior tras migración, rutas heredadas, resultados históricos con `resolvedAt=null`, lectura de múltiples intervenciones sintéticas con control apagado y aislamiento de cuentas. Las pruebas activas retiran el índice sólo en PostgreSQL sintético y lo restauran tras limpiar; no se modificó ninguna base real. Lint focal y sintaxis TS/TSX aprobados; no equivalen a tipos/build integrales ni navegador.

## Requisitos pendientes de la propuesta de urgencia antes de activar

- El envío inmediato avisa a la guardia elegida y a jefatura, pero no acredita entrega ni contacto humano.
- Mientras la guardia no tome y el trabajo quede sin `assigneeId`, el escalador vigente NO reitera: su filtro requiere asignación. Esta implementación no añade un temporizador o suplente automático.
- Antes de activar, definir cobertura real, respuesta al aviso no tomado, suplente/escalamiento y plazos autorizados. No se inventaron valores ni una política nueva. Ante riesgo inmediato la UI indica contacto directo y salida segura.
- Cambiar clasificación de una distribución ya existente exige una decisión posterior de producto/política; no se rebaja urgencia o validación silenciosamente con un reintento.

Los avisos nuevos usan `internalOnly` y el materializador lo propaga a las notificaciones de tareas/HK. Se probó que distribuir y asignar no invoca `queueOperationalMail`, incluso con destinatarios sintéticos que tienen correo habilitado. Las notificaciones nativas anteriores conservan su canal cuando no proceden de la distribución nueva. El cambio compatible de `NotifyInput.internalOnly` pertenece a la integración del coordinador.
