# Equipo y horarios · AROH 1.41.1

## Propósito y límite

Planificar usuarios por área, revisar brechas y conservar evidencia de la recepción de cambios. La malla no representa presencia física, control biométrico, nómina ni turnos de caja/Recepción. No incorpora funcionalidad PMS.

**Colaborador = Usuario del sistema.** No existe un alta independiente de personas en Equipo y horarios. La cuenta se crea una sola vez en Usuarios.

## Puesta en marcha

1. Abre Equipo y horarios y selecciona el área. Al preparar el calendario, sus usuarios activos y visibles aparecen automáticamente según el área principal de la cuenta; esto no les asigna jornadas ni concede acceso al módulo.
2. En Colaboradores → Usuarios del área puedes configurar las horas semanales y añadir usuarios existentes a áreas adicionales. Nombre, rol y estado proceden de Usuarios. Un registro histórico sin vínculo requiere seleccionar explícitamente su cuenta; no se adivinan identidades por coincidencia de nombres.
3. En Plantillas configura código, descripción, inicio y término; marca el día siguiente cuando corresponda. Recepción trae RD01 08–19, RD02 11–22 y RN01 21–08 del día siguiente. Una nueva revisión conserva las asignaciones anteriores.
4. En Cobertura mínima define días, franjas, función exacta opcional y cantidad de personas. Sin reglas no se afirma que la dotación sea suficiente. En Alcance y feriados revisa fechas y concesiones adicionales por cuenta.
5. Crea una malla futura de 1–63 días, sin periodos superpuestos en el área. Completa manualmente o carga un archivo y revisa observaciones antes de incorporar. Casilla vacía significa sin programar; Libre es un registro explícito.
6. Publica con motivo. Sólo los roles habilitados acceden; personas programadas y habilitadas reciben aviso y confirmación por revisión. Los horarios personales siguen accesibles fuera del turno operativo. Confirmar recepción no cierra avisos Housekeeping ni acredita asistencia.

## Usuarios, identidad e historial

El perfil técnico ScheduleCollaborator es una extensión 1:1 de la cuenta existente, enlazada por userId único. Sus claves y códigos anteriores se conservan para no romper asignaciones, importaciones o auditoría. No se permite crear un perfil sin usuario ni sustituir una identidad vinculada por otra persona.

Los selectores utilizan usuarios activos, no eliminados y no ocultos. Un usuario puede existir sin horarios. Desactivar u ocultar una cuenta impide nuevas asignaciones; las anteriores se conservan y las futuras pueden retirarse con motivo e historial. El calendario y las cargas consultan el nombre vigente. Las nuevas asignaciones toman el rol vigente; los registros históricos conservan su función original.

Los usuarios del área principal se habilitan automáticamente para preparación de su calendario. Las áreas adicionales requieren configuración explícita y comprobación del alcance del operador. Un registro histórico sin vínculo no es seleccionable hasta asociarlo a la cuenta correcta. No se crean cuentas ni se borran registros durante esta integración.

## Horas semanales y descanso

La referencia semanal se introduce y muestra en **horas**: por ejemplo, 42 h o 42,5 h. Cero significa sin referencia; el intervalo técnico aceptado es 0–168 h. No se interpreta como una política laboral universal ni como liquidación de remuneraciones.

Las horas programadas corresponden al intervalo completo entre inicio y término. **El descanso no se configura ni se calcula en este módulo:** no hay campos de colación, descuentos de pausa ni bloqueo por descanso mínimo entre jornadas. Los datos de descanso de versiones anteriores permanecen almacenados para conservación histórica, pero no afectan los cálculos actuales.

Libre, vacaciones y ausencias permanecen como estados del calendario y no generan horas. Los solapamientos de jornadas, incompatibilidades con ausencias y la pertenencia al área siguen comprobándose.

America/Santiago calcula instantes reales y cambios estacionales. Una noche puede durar diez o doce horas al cambiar el reloj; horarios locales inexistentes no se normalizan silenciosamente. Las semanas comienzan lunes y reparten noches por día civil, incluyendo otras áreas publicadas sólo como total agregado. Un ciclo de ocho días no se confunde con una semana.

Internamente se conservan columnas de minutos para compatibilidad y precisión. La entrada semanal en horas se convierte una sola vez al guardar y se vuelve a expresar en horas al mostrar. No hay migración ni reinterpretación de valores existentes.

## Permisos y alcance

| Permiso | Capacidad |
| --- | --- |
| schedule.self.view | Horario propio publicado y recepción de cambios; informar realización de extra propio aprobado. |
| schedule.view | Publicados del área principal y áreas concedidas. |
| schedule.view.all | Consulta global de publicados; no amplía escritura. |
| schedule.manage | Preparar borrador, cargar y gestionar asignaciones en áreas autorizadas. |
| schedule.publish | Publicar y autorizar cambios de programación publicada en áreas autorizadas. |
| schedule.catalog.manage | Datos de planificación de usuarios, plantillas y reglas de cobertura del alcance autorizado. |
| schedule.extra.approve | Aprobar/rechazar y validar extras en áreas autorizadas. |
| schedule.configure | Administrar alcance adicional y feriados globales. |

Administrador tiene acceso completo. La corrección 1.41.1 no habilita permisos a otros roles. Preparar una malla y publicarla son facultades distintas. Un perfil con manage sin publish no cambia horarios ya publicados. Poder ser programado no concede acceso al calendario del equipo.

## Cambios en calendario

Arrastrar abre una decisión explícita; también existe botón/formulario para móvil y teclado. Mover mantiene persona; Reasignar cambia persona y cancela origen; Intercambiar conserva ambos turnos en destinos invertidos; Agregar conserva origen y suma una asignación. El servidor comprueba usuario activo, pertenencia, solapes y versión; cancela/crea en una única transacción. Los registros anteriores quedan auditados. Asignaciones con extras requieren revisión específica y no transfieren aprobaciones mediante arrastre.

Cambios publicados exigen motivo, generan nueva revisión y notificación a afectados habilitados, incluida la persona cuyo turno fue retirado. La confirmación anterior no cubre cambios nuevos. El estado pendiente sigue visible hasta confirmar; no hay todavía un servicio periódico de recordatorio/escalamiento.

## Importación

PDF con texto posicionado, XLSX, CSV y TSV, máximo 3 MB y 2.000 asignaciones. No OCR ni inferencia IA. Se reconoce malla con fechas en columnas/glosa o filas ID_COLABORADOR;FECHA;CODIGO;INICIO;TERMINO. La denominación técnica ID_COLABORADOR y sus códigos se conservan por compatibilidad; corresponden al perfil del usuario, no a otra persona.

El código identifica sin ambigüedad; en una malla visual el nombre vigente debe coincidir con un único usuario del área. Código de turno y horas deben coincidir con la plantilla vigente. Fecha fuera de periodo, usuario desconocido/inactivo, código incorrecto, blanco o duplicado genera observación.

Revisar guarda nombre/hash de archivo, versión, filas normalizadas y observaciones; no guarda el binario original. Releer una carga en revisión actualiza coincidencias según las cuentas vigentes. Incorporar vuelve a validar y es atómico: coincidencias ya existentes se omiten; contradicciones bloquean la carga completa. Una revisión queda obsoleta cuando cambia la malla. Repetir un archivo ya aplicado no duplica asignaciones ni restaura cambios manuales posteriores.

## Extras y feriados

Extensión suma tiempo al término; turno adicional registra una jornada completa. Estados: pendiente → aprobado/rechazado; aprobado → realización informada → validada. Aprobación no acredita realización. Rechazar un turno adicional futuro cancela su asignación y libera la casilla conservando evidencia; rechazar una extensión futura conserva horario base. No se rechazan extras ya iniciados. Una extensión pendiente aporta sólo horario base a la cobertura; un turno adicional pendiente no cubre dotación. Los totales de solicitudes se identifican por separado. Informar realización requiere término del extra aprobado y evidencia textual.

Feriados nacionales 2026 precargados con fuente oficial. Años futuros/extraordinarios/locales se administran manualmente. Quienes trabajan se identifican por solape real con el día del feriado, incluso al iniciar la noche anterior. Referencia informativa; no calcula recargos legales.

## Invariantes técnicas y verificación

Servicios canónicos: schedule-users.ts, schedule-catalog.ts, schedules.ts y schedule-import.ts; acceso schedule-access.ts. Server Actions validan y llaman servicios; interfaz presenta decisiones. Bloqueo de áreas y usuarios de planificación en orden estable, bloqueo de plan, versión optimista y requestKey con hash. Historial y auditoría en la misma transacción. Alcance y privacidad también se aplican a auditoría, historial y herramientas de lectura de Fronti.

Esta corrección no cambia esquema, dependencias, DNS, infraestructura, Shift, BoxSession, caja ni custodia. La ruta /equipo permanece exenta del bloqueo visual de recepción de turno porque consultar planificación no es registrar operación.

Las regresiones se ejecutan en PostgreSQL desechable mediante Compuerta. El resultado de la última ejecución y el SHA servido en Production deben comprobarse antes de declarar el despliegue verificado.

La entrega automática de incidencias al siguiente usuario de área, escalamiento y reporte diario constituyen una fase posterior. Ningún turno de Recepción se reutiliza como presencia de Housekeeping/Mantenimiento.
