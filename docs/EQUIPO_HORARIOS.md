# Equipo y horarios · AROH 1.42.0

## Propósito y límite

Planificar personal por área, revisar brechas y conservar evidencia de la recepción de cambios. La malla no representa presencia física, control biométrico, nómina ni turnos de caja/Recepción. No incorpora funcionalidad PMS.

## Puesta en marcha

1. Administrador abre Equipo → Colaboradores y selecciona un usuario existente y lo añade al área. El nombre proviene de la cuenta; una misma persona conserva una identidad, áreas e historial. Referencia semanal expresada en horas. Los perfiles anteriores sin cuenta se conservan como históricos y deben vincularse antes de programar nuevas asignaciones.
2. En Plantillas configura códigos y glosa. Recepción trae RD01 08–19, RD02 11–22 y RN01 21–08 del día siguiente. Son once horas de permanencia y referencia; se cuenta la jornada completa sin configuración ni descuento de colaciones o descansos. Revisar una plantilla conserva las asignaciones anteriores.
3. En Cobertura mínima define días, franjas, función exacta opcional y cantidad de personas. Sin reglas no se afirma que la dotación sea suficiente. En Alcance y feriados revisa fechas y concesiones adicionales por cuenta.
4. Crea malla futura de 1–63 días, sin periodos superpuestos en el área. Completa manualmente o carga archivo y revisa observaciones antes de incorporar. Casilla vacía significa sin programar; Libre es un registro explícito.
5. Publica con motivo. Sólo los roles habilitados acceden; personas vinculadas reciben aviso y confirmación por revisión. Horarios personales siguen accesibles fuera del turno operativo. Confirmar recepción no cierra avisos Housekeeping ni acredita asistencia.

## Permisos y alcance

| Permiso | Capacidad |
| --- | --- |
| schedule.self.view | Horario propio publicado y recepción de cambios; informar realización de extra propio aprobado. |
| schedule.view | Publicados del área principal y áreas concedidas. |
| schedule.view.all | Consulta global de publicados; no amplía escritura. |
| schedule.manage | Preparar borrador, cargar y gestionar asignaciones en áreas autorizadas. |
| schedule.publish | Publicar y autorizar cambios de programación publicada en áreas autorizadas. |
| schedule.catalog.manage | Colaboradores, plantillas y reglas de cobertura del alcance autorizado. |
| schedule.extra.approve | Aprobar/rechazar y validar extras en áreas autorizadas. |
| schedule.configure | Administrar alcance adicional y feriados globales. |

Administrador tiene acceso completo. Otros roles conservan todos estos permisos apagados por defecto. Preparar una malla y publicarla son facultades distintas. Un perfil con manage sin publish no cambia horarios ya publicados.

## Cambios en calendario

Arrastrar abre una decisión explícita; también existe botón/formulario para móvil y teclado. Mover mantiene persona, Reasignar cambia persona y cancela origen, Intercambiar conserva ambos turnos en destinos invertidos, Agregar conserva origen y suma una asignación. El servidor comprueba solapes, pertenencia y versión; cancela/crea en una única transacción. Los registros anteriores quedan auditados. Asignaciones con extras requieren revisión específica y no transfieren aprobaciones mediante arrastre.

Cambios publicados exigen motivo, generan nueva revisión publicada y notificación a afectados habilitados, incluida la persona cuyo turno fue retirado. La confirmación anterior no cubre cambios nuevos. El estado pendiente sigue visible hasta confirmar; no hay todavía un servicio periódico de recordatorio/escalamiento.

## Importación

PDF con texto posicionado, XLSX, CSV y TSV, máximo 3 MB y 2.000 asignaciones. No OCR ni inferencia IA. Se reconoce malla con fechas en columnas/glosa o filas ID_COLABORADOR;FECHA;CODIGO;INICIO;TERMINO. El código del colaborador identifica sin ambigüedad; en malla visual el nombre completo debe coincidir con uno solo del área. Código de turno y horas deben coincidir con plantilla vigente. Fecha fuera de periodo, persona desconocida, código incorrecto, blanco o duplicado genera observación.

Revisar guarda nombre/hash de archivo, versión, filas normalizadas y observaciones; no guarda el binario original. Incorporar vuelve a validar y es atómico: coincidencias ya existentes se omiten, contradicciones bloquean la carga completa. Una revisión queda obsoleta cuando cambia la malla. Repetir archivo aplicado no duplica asignaciones ni restaura cambios manuales posteriores.

## Horas, extras y feriados

America/Santiago calcula instantes reales y cambios estacionales. Una noche puede durar diez/doce horas al cambiar el reloj; horarios locales inexistentes no se normalizan silenciosamente. Colaciones y descanso mínimo de registros antiguos no descuentan horas ni cobertura, ni bloquean nuevas asignaciones; los solapes y ausencias incompatibles sí se validan. Referencia semanal configurable por persona, sin aplicar automáticamente una política laboral universal; semanas comienzan lunes y reparten noches por día civil, incluyendo otras áreas publicadas sólo como total agregado.

Extensión suma minutos al término; turno adicional registra jornada completa. Estados: pendiente → aprobado/rechazado; aprobado → realización informada → validada. Aprobación no acredita realización. Rechazar un turno adicional futuro cancela su asignación y libera la casilla conservando evidencia; rechazar una extensión futura conserva horario base y libera los minutos adicionales. No se rechazan extras ya iniciados. Una extensión pendiente aporta sólo horario base; un turno adicional pendiente no cubre dotación. Solicitudes se muestran por separado para supervisión. Informar realización requiere término del extra aprobado, minutos y evidencia textual.

Feriados nacionales 2026 precargados con fuente oficial. Años futuros/extraordinarios/locales se administran manualmente. Quienes trabajan se identifican por solape real con el día del feriado, incluso al iniciar la noche anterior. Referencia informativa; no calcula recargos legales.

## Invariantes técnicas

Servicios canónicos: schedule-catalog.ts, schedules.ts, schedule-import.ts; acceso schedule-access.ts. Server Actions validan y llaman servicios, interfaz presenta decisiones. Bloqueo de áreas y colaboradores en orden estable, bloqueo de plan, versión optimista y requestKey con hash. Historial y auditoría en misma transacción. Scope y privacidad también se aplican a auditoría, historial y herramientas de lectura Fronti.

Migración aditiva revisada, probada en PostgreSQL desechable de Compuerta antes de Production. No cambios automáticos a personal real, mallas reales, Shift, BoxSession, caja o custodia. La ruta /equipo queda exenta del bloqueo visual de recepción de turno porque consultar planificación no es registrar operación.

La entrega automática de incidencias al siguiente colaborador de área, escalamiento y reporte diario constituyen una fase posterior. Ningún turno de Recepción se reutiliza como presencia de Housekeeping/Mantenimiento.

### Revisión de archivos y ayuda de Fronti (1.43.0)

Después de añadir usuarios al área o corregir un tipo de turno, usa **Volver a revisar coincidencias** en el archivo ya leído. No necesitas cargar de nuevo el PDF. Revisa las observaciones y confirma la incorporación; revisar no cambia el calendario.

Los horarios usan siempre el código y reloj de 24 horas. **Día siguiente** identifica las noches. Fronti puede consultar personas, programación, cobertura y observaciones con los mismos permisos del usuario. Dentro del calendario, «Revisa este horario y sus errores» ofrece una revisión de datos verificados. Publicar el horario no inicia un turno ni confirma asistencia.
