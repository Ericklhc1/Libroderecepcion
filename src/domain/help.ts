import type { PermissionKey } from '@/lib/permissions';

/**
 * Central de ayuda: los procedimientos reales del sistema.
 *
 * Es documentación, no un modelo de lenguaje. La decisión es deliberada: una
 * respuesta inventada sobre cómo cerrar una caja es peor que no tener ayuda.
 * Acá cada procedimiento dice lo que el sistema hace de verdad, y **está en el
 * mismo repositorio que el código**, así que una regla que cambia y una ayuda
 * que miente se ven en el mismo cambio.
 *
 * Los tutoriales guiados viven en `tutorial-tour.ts`, pero ambos catálogos
 * se mantienen en el mismo dominio y describen las mismas reglas operativas.
 *
 * `action` es lo único que ejecuta. Sólo acciones **reversibles** del núcleo
 * vigente. El legado PMS/estadías no se ejecuta desde la ayuda.
 */

/** Acciones que la ayuda puede ejecutar. Todas reversibles, sin excepción. */
export type HelpActionKey = 'regenerar-entrega';

export const HELP_ACTIONS: Record<
  HelpActionKey,
  { label: string; permission: PermissionKey; explains: string }
> = {
  'regenerar-entrega': {
    label: 'Regenerar el resumen de mi entrega',
    permission: 'shift.handover',
    explains:
      'Vuelve a calcular el resumen automático con el estado actual. Tus notas manuales ' +
      'se conservan: sólo se reemplaza lo que el sistema había puesto solo.',
  },
};

export type HelpTopic = {
  id: string;
  /** Cómo lo buscaría alguien del mesón, en sus palabras. */
  question: string;
  /** Los pasos. Una línea por paso, sin numerar: la interfaz numera. */
  steps: string[];
  /** Lo que conviene saber antes de hacerlo, si algo. */
  caveat?: string;
  /** Adónde lleva el botón «Ir». */
  route?: string;
  /** Se muestra sólo si la persona tiene al menos uno de estos permisos. */
  anyOf?: PermissionKey[];
  /** Palabras con las que alguien podría buscarlo aunque no use el título. */
  keywords: string[];
  action?: HelpActionKey;
  /** Se usa en el tutorial del primer ingreso. */
  tutorial?: boolean;
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'tomar-turno',
    question: '¿Cómo inicio y recibo mi turno?',
    steps: [
      'Entra a Mi turno.',
      'Si el turno saliente todavía está activo o cerrando, espera: el sistema no permite abrir el siguiente turno en paralelo.',
      'Cuando el saliente quede cerrado, abre la entrega pendiente. La entrega queda en bandeja y no está preasignada a ningún recepcionista ni turno.',
      'Dentro de esa misma entrega, recuenta Caja si corresponde y valida físicamente las garantías. No uses la pestaña Caja general para este paso.',
      'Confirma la recepción de la entrega y después pulsa «Abrir mi turno». El sistema enlaza esa continuidad al turno nuevo y habilita la operación.',
    ],
    caveat:
      'Recepción sólo puede operar con un turno ACTIVO. Sin turno, durante la recepción y durante el cierre, Novedades, Caja operativa y Llaves quedan bloqueadas.',
    route: '/turno',
    anyOf: ['shift.start'],
    keywords: ['turno', 'iniciar', 'abrir', 'recibir', 'relevo', 'caja', 'recontar', 'firma', 'bloqueado', 'entrar'],
    tutorial: true,
  },

  {
    id: 'cambiar-tipo-turno',
    question: '¿Cómo corrijo un turno DÍA a NOCHE o viceversa?',
    steps: [
      'En Administración > Roles y permisos, activa «Cambiar tipo de turno Día/Noche» para los roles autorizados.',
      'Entra a Mi turno mientras el turno esté INICIADO o ACTIVO.',
      'Pulsa «CAMBIAR A TURNO DÍA» o «CAMBIAR A TURNO NOCHE», según corresponda.',
      'La Central conserva la misma fecha operativa y recalcula automáticamente la ventana: DÍA 07:00–20:00 o NOCHE 20:00–08:00.',
      'El cambio queda registrado en Auditoría con el tipo y horario anterior y posterior.',
    ],
    caveat:
      'Esta función corrige el tipo del turno; no cambia al titular ni borra participantes. Si el cierre ya comenzó, primero hay que cancelar la preparación de cierre.',
    route: '/turno',
    anyOf: ['shift.reassign'],
    keywords: ['turno', 'día', 'dia', 'noche', 'cambiar', 'corregir', 'tipo', 'horario', 'franja'],
  },

  {
    id: 'recibir-caja',
    question: '¿Cómo recibo la Caja y valido el relevo?',
    steps: [
      'El recepcionista saliente debe haber cerrado formalmente su turno.',
      'Abre la entrega pendiente desde Mi turno. Cualquier recepcionista o supervisor autorizado puede tomarla; no pertenece todavía a un turno entrante.',
      'Dentro de la ficha de entrega, recuenta el efectivo físicamente por denominación y valida las garantías bajo custodia como elementos separados. La Caja general seguirá bloqueada hasta iniciar tu turno.',
      'Confirma la recepción de la entrega. La recepción queda registrada a tu nombre, pero todavía no crea un turno nuevo.',
      'Si eres quien continuará la operación, inicia entonces tu propio turno. El sistema enlaza la entrega recibida al nuevo turno.',
      'Con la recepción confirmada, imprime el acta de entrega/recepción para las firmas correspondientes.',
    ],
    caveat:
      'El acta deja además un espacio de validación/auditoría para Supervisión o el auditor designado. Si el recuento no coincide, la diferencia debe quedar documentada; no se corrige ocultándola.',
    route: '/turno',
    anyOf: ['shift.receive'],
    keywords: ['caja', 'arqueo', 'fondo', 'efectivo', 'recibir', 'recontar', 'dinero', 'divisa', 'garantía', 'firma'],
    tutorial: true,
  },
  {
    id: 'entregar-turno',
    question: '¿Cómo cierro y entrego mi turno?',
    steps: [
      'En Mi turno, inicia la preparación de entrega. Desde ese momento tu cuenta queda bloqueada para la operación general.',
      'Revisa los pendientes operativos vigentes. Todo lo que siga abierto continúa automáticamente entre turnos hasta resolverse; después completa el cierre de Caja.',
      'Prepara y revisa la entrega; agrega sólo las notas manuales que el sistema no pueda conocer.',
      'Envía la entrega y cierra formalmente tu turno.',
      'La entrega cerrada queda entonces disponible para cualquier recepcionista o supervisor autorizado, sin preasignación.',
      'Quien la tome recuenta Caja y confirma la recepción; sólo después se abre el turno que continuará la operación.',
      'Tras la recepción, imprime el acta para las firmas correspondientes; Supervisión o auditoría valida el cierre posteriormente.',
    ],
    caveat:
      'Enviar la entrega no libera al saliente. La participación termina únicamente al cerrar formalmente el turno. Una entrega cerrada debe recibirse antes de que se abra el siguiente turno operativo.',
    route: '/turno',
    anyOf: ['shift.handover'],
    keywords: ['entregar', 'entrega', 'cierre', 'turno', 'resumen', 'traspaso', 'caja', 'firma'],
    action: 'regenerar-entrega',
    tutorial: true,
  },


  {
    id: 'inventario-llaves',
    question: '¿Cómo hago el inventario físico de llaves por piso?',
    steps: [
      'Entra a Llaves y elige Piso 4, 5 o 6.',
      'Quita los filtros antes de iniciar un conteo oficial.',
      'Registra cuántas llaves encontraste por habitación y cuántas están fuera de servicio.',
      'Guarda el conteo: el sistema calcula faltantes y sobrantes y conserva fecha, hora y usuario.',
    ],
    caveat:
      'El inventario físico no consulta PMS, reservas ni estadías. Si una llave está entregada o extraviada, su estado se gestiona como objeto físico.',
    route: '/llaves',
    anyOf: ['key.inventory', 'key.stock'],
    keywords: ['llave', 'llaves', 'inventario', 'piso', 'contar', 'faltante', 'sobrante', 'extraviada'],
    tutorial: true,
  },
  {
    id: 'garantia',
    question: '¿Cómo registro o devuelvo una garantía en efectivo?',
    steps: [
      'Entra a Caja.',
      'Usa «Nueva garantía» para registrar el dinero bajo custodia. No lo dupliques como Novedad: la garantía ya conserva su propia trazabilidad entre turnos.',
      'El nombre, habitación o referencia son contexto libre opcional: no necesitas crear una reserva.',
      'Cuando corresponda devolverla, usa la acción de devolución en la misma sección de Caja.',
    ],
    caveat:
      'Caja conserva la trazabilidad financiera sin depender de PMS. Los vínculos históricos de reservas sólo existen para datos antiguos.',
    route: '/caja',
    anyOf: ['cash.guarantee_in', 'cash.guarantee_out'],
    keywords: ['garantía', 'garantia', 'deposito', 'efectivo', 'devolver', 'caja'],
  },
  {
    id: 'incidencia',
    question: '¿Cómo registro una incidencia?',
    steps: [
      'Entra a Novedades y usa «Nueva incidencia» en la cabecera del módulo.',
      'Indica la habitación o el área: sin eso nadie sabe dónde ir.',
      'Describe qué pasó y qué hiciste de inmediato.',
    ],
    route: '/libro',
    keywords: ['incidencia', 'problema', 'reclamo', 'registrar', 'novedad', 'anotar'],
    tutorial: true,
  },
  {
    id: 'comunicado',
    question: '¿Cómo aviso algo que nadie puede dejar de leer?',
    steps: [
      'Entra a Supervisión.',
      'Pulsa «Emitir comunicado».',
      'Elige si va a todo el personal o a una persona.',
      'El aviso bloquea su pantalla hasta que confirmen la lectura por escrito.',
    ],
    caveat:
      'Verás qué escribió cada uno al confirmar. Úsalo para lo que de verdad no puede ' +
      'esperar: si todo es urgente, nada lo es.',
    route: '/supervision',
    anyOf: ['announcement.manage'],
    keywords: ['comunicado', 'aviso', 'avisar', 'obligatorio', 'bloquear', 'leer'],
  },
  {
    id: 'usuario-nuevo',
    question: '¿Cómo creo una cuenta para alguien?',
    steps: [
      'Entra a Administración y luego a Usuarios.',
      'Crea la cuenta: el sistema genera la clave, nadie la escribe.',
      'Copia las credenciales del panel antes de cerrarlo: la clave no se guarda en claro.',
    ],
    caveat:
      'Varias cuentas pueden compartir el mismo correo. Lo que identifica a cada una es su ' +
      'usuario, del estilo @EHerrera, y es con eso con lo que se entra.',
    route: '/admin/usuarios',
    anyOf: ['user.manage'],
    keywords: ['usuario', 'cuenta', 'crear', 'clave', 'contraseña', 'personal', 'alta'],
  },
  {
    id: 'turno-largo',
    question: '¿Cómo programo un turno que no dura ocho horas?',
    steps: [
      'Entra a Administración y luego a Turnos.',
      'Elige fecha y tipo de turno como siempre.',
      'Escribe hora de inicio y duración: hasta 12 horas, en horas o medias horas.',
      'Deja las dos casillas vacías para usar el horario normal.',
    ],
    caveat:
      'Las dos van juntas: una hora sin duración es una ventana a medias, y el sistema usa ' +
      'el horario nominal en ese caso.',
    route: '/admin/turnos',
    anyOf: ['shift.manage'],
    keywords: ['turno', 'horario', '12 horas', 'doce', 'duración', 'programar', 'archivar'],
  },
  {
    id: 'configurar-correo',
    question: '¿Cómo configuro el correo del hotel?',
    steps: [
      'Entra a Administración y luego a Correo.',
      'Escribe el servidor de salida y su puerto: 465 usa TLS directo, 587 negocia STARTTLS.',
      'Escribe el usuario del buzón, su clave y el remitente.',
      'Guarda y envía un correo de prueba: es lo único que confirma que funciona.',
    ],
    caveat:
      'La clave se guarda cifrada y no se puede volver a leer desde la pantalla. Si la prueba ' +
      'falla, el mensaje que aparece es el del servidor de correo, y es lo que dice qué corregir.',
    route: '/admin/correo',
    anyOf: ['system.configure'],
    keywords: [
      'correo',
      'mail',
      'email',
      'smtp',
      'imap',
      'pop3',
      'buzon',
      'casilla',
      'enviar',
      'clave',
      'credenciales',
      'no llegan',
    ],
  },
  {
    id: 'novedades-habitacion',
    question: '¿Cómo uso Novedades / habitación?',
    steps: [
      'Entra a Novedades / habitación para ver las 89 habitaciones canónicas: 401–429, 501–530 y 601–630.',
      'Toca una habitación: el panel de detalle se abre con los objetos vinculados a ese número.',
      'Revisa novedades, incidencias, tareas, seguimientos, alertas y garantías desde el mismo contexto.',
      'Abre el objeto concreto desde su enlace cuando necesites gestionarlo; el monitor no crea una copia.',
    ],
    caveat:
      'La habitación es contexto operativo. Esta pantalla no administra ocupación, check-in ni check-out y no sustituye a FNSrooms.',
    route: '/novedades/habitacion',
    keywords: ['habitacion', 'habitaciones', '401', 'mapa', 'monitor', 'novedades', 'contexto', '89'],
  },
  {
    id: 'selector-habitacion',
    question: '¿Por qué la habitación aparece igual en novedades, tareas, alertas y Caja?',
    steps: [
      'Los formularios que necesitan habitación usan el mismo catálogo canónico.',
      'Selecciona el número una sola vez dentro del formulario que estás creando.',
      'El registro conserva esa habitación y automáticamente aparece en Novedades / habitación cuando corresponde.',
    ],
    caveat:
      'Vincular una habitación no convierte el objeto en una reserva ni crea una estadía dentro de AROH.',
    route: '/novedades/habitacion',
    keywords: ['habitacion', 'selector', 'desplegable', 'catalogo', 'formulario', 'garantia', 'tarea', 'alerta'],
  },
  {
    id: 'tarea-programada',
    question: '¿Cómo creo una tarea para que empiece más adelante?',
    steps: [
      'Crea o edita la tarea desde Novedades o Tareas.',
      'Usa «Inicio programado» para indicar desde cuándo debe comenzar a trabajarse.',
      'Usa «Fecha límite» sólo si además necesitas controlar vencimiento.',
      'La tarea existe desde que la creas, pero AROH distingue que todavía está programada si su inicio está en el futuro.',
    ],
    route: '/tareas',
    anyOf: ['task.create', 'task.edit', 'task.assign'],
    keywords: ['tarea', 'programar', 'programada', 'inicio', 'starts', 'fecha', 'vencimiento', 'futuro'],
  },
  {
    id: 'validar-tarea',
    question: '¿Cómo funciona una tarea que requiere validación de Supervisión?',
    steps: [
      'La persona responsable ejecuta la tarea y la marca como realizada cuando corresponde.',
      'Supervisión revisa el resultado desde su Centro o desde la tarea.',
      'Si cumple, la valida; si no cumple, puede devolverla para corrección.',
      'El historial conserva quién realizó, quién validó y los cambios de estado.',
    ],
    caveat:
      'Realizada y validada no significan lo mismo. La validación existe para que Supervisión confirme el cierre cuando el flujo lo exige.',
    route: '/supervision',
    anyOf: ['supervision.task.validate'],
    keywords: ['tarea', 'validar', 'validacion', 'realizada', 'devuelta', 'supervision', 'aprobar'],
  },
  {
    id: 'seguimiento',
    question: '¿Cómo uso un seguimiento sin convertirlo en otra tarea?',
    steps: [
      'Crea un seguimiento desde el objeto que necesita continuidad o desde Seguimientos.',
      'Define la próxima acción, responsable y fecha programada cuando corresponda.',
      'Mantén el seguimiento pendiente hasta confirmar que la continuidad realmente se cumplió.',
      'El seguimiento puede apuntar a una novedad o tarea sin duplicar su contenido.',
    ],
    route: '/seguimientos',
    anyOf: ['followup.create', 'followup.manage', 'supervision.followup.manage'],
    keywords: ['seguimiento', 'continuidad', 'proxima accion', 'programado', 'pendiente', 'recordar', 'responsable'],
  },
  {
    id: 'alerta-programada',
    question: '¿Cómo creo una alerta programada?',
    steps: [
      'Entra a Alertas o créala desde una novedad, tarea o habitación.',
      'Define cuándo debe avisar y a quién: una persona, un grupo o alcance global según tus permisos.',
      'Si nace desde otro objeto, conserva el vínculo al origen.',
      'Cuando llegue la hora, la alerta genera la llamada de atención correspondiente sin convertir el objeto de origen en otra cosa.',
    ],
    caveat:
      'Alerta = llamada de atención programable. No es una tarea, no es una novedad y no es la campana de notificaciones.',
    route: '/alertas',
    keywords: ['alerta', 'programar', 'timer', 'recordatorio', 'hora', 'grupo', 'global', 'persona'],
  },
  {
    id: 'notificacion-origen',
    question: '¿Qué pasa cuando abro o marco como leída una notificación?',
    steps: [
      'La notificación te informa que ocurrió algo relevante.',
      'Ábrela para ir directamente al objeto que la originó cuando existe un enlace.',
      'Marcarla como leída limpia el aviso y sincroniza el estado de la campana/badge.',
      'Gestiona o resuelve el objeto en su módulo original si todavía requiere acción.',
    ],
    caveat:
      'Leer una notificación no resuelve automáticamente una tarea, novedad, alerta, hallazgo ni diferencia de Caja.',
    route: '/notificaciones',
    keywords: ['notificacion', 'campana', 'leida', 'badge', 'aviso', 'abrir', 'origen', 'push'],
  },
  {
    id: 'push-dispositivo',
    question: '¿Cómo activo las notificaciones Push en mi teléfono o navegador?',
    steps: [
      'Abre la campana de Notificaciones.',
      'Activa las notificaciones del dispositivo cuando el navegador ofrezca la opción y concede el permiso del sistema.',
      'La suscripción queda asociada a ese navegador/dispositivo; puedes tener más de uno.',
      'Usa la prueba disponible en la campana para confirmar que el dispositivo realmente recibe Push.',
    ],
    caveat:
      'Web Push depende de que el navegador y el sistema operativo lo permitan. El permiso del dispositivo no se puede forzar desde AROH.',
    route: '/notificaciones',
    keywords: ['push', 'iphone', 'telefono', 'navegador', 'permiso', 'notificaciones', 'dispositivo', 'vapid'],
  },
  {
    id: 'arqueo-caja',
    question: '¿Cómo hago un arqueo y qué significa la diferencia?',
    steps: [
      'Entra a Caja y abre Arqueos.',
      'Cuenta físicamente el efectivo por divisa/denominación y registra el total contado.',
      'AROH compara contado versus esperado y deja la diferencia en el arqueo.',
      'Abre el arqueo por su #ID para revisar esperado, contado, diferencia, fecha y responsable.',
    ],
    caveat:
      'Una diferencia no debe desaparecer editando el pasado. Se investiga y, si corresponde, se regulariza con su propio movimiento trazable.',
    route: '/caja?seccion=auditorias',
    anyOf: ['cash.view', 'cash.audit'],
    keywords: ['arqueo', 'caja', 'diferencia', 'descuadre', 'contado', 'esperado', 'efectivo', 'id'],
  },
  {
    id: 'regularizar-diferencia',
    question: '¿Cómo regularizo una diferencia de Caja sin borrar el descuadre original?',
    steps: [
      'Abre Caja e identifica primero el arqueo o diferencia que quieres explicar.',
      'Si tienes autorización, usa la regularización de entrada o salida según el caso.',
      'Registra el monto y motivo de la corrección.',
      'El arqueo original conserva lo que ocurrió y la regularización explica el movimiento posterior.',
    ],
    caveat:
      'Regularizar corrige el efectivo esperado hacia adelante; no reescribe el arqueo histórico ni debe usarse para ocultar una causa no investigada.',
    route: '/caja',
    anyOf: ['cash.approve'],
    keywords: ['regularizar', 'regularizacion', 'diferencia', 'descuadre', 'caja', 'sobrante', 'faltante', 'corregir'],
  },
  {
    id: 'tesoreria',
    question: '¿Cómo registro una transferencia a Tesorería?',
    steps: [
      'Entra a Caja y abre Movimientos.',
      'Registra la transferencia indicando divisa, monto y referencia requerida.',
      'Confirma el movimiento sólo cuando el dinero efectivamente salga de la custodia de Recepción.',
      'Consulta después el movimiento por fecha o búsqueda para reconstruir la trazabilidad.',
    ],
    route: '/caja?seccion=movimientos',
    anyOf: ['cash.treasury_transfer'],
    keywords: ['tesoreria', 'transferencia', 'caja', 'egreso', 'dinero', 'monto', 'divisa', 'movimiento'],
  },
  {
    id: 'folio-gimnasio',
    question: '¿Cómo emito o consulto un folio de gimnasio?',
    steps: [
      'Entra a Caja y usa «Folio gimnasio».',
      'Selecciona fecha de servicio, habitación y huésped; el recepcionista se toma de tu sesión.',
      'El folio queda en el historial de Gimnasio dentro de Caja.',
      'Durante 30 días también aparece como reflejo en Novedades / habitación, desde donde puedes volver al folio de Caja.',
    ],
    caveat:
      'El reflejo por habitación no es una segunda copia: Caja sigue siendo la fuente de verdad del folio.',
    route: '/caja?seccion=gimnasio',
    anyOf: ['cash.view'],
    keywords: ['gimnasio', 'gym', 'folio', 'habitacion', 'huesped', 'caja', '30 dias', 'servicio'],
  },
  {
    id: 'ticket-estacionamiento',
    question: '¿Cómo emito un ticket de estacionamiento?',
    steps: [
      'Entra a Caja y usa «Ticket estacionamiento».',
      'Selecciona fecha, habitación y huésped.',
      'Ingresa el ID Reserva de FNSrooms cuando corresponda; el campo no usa patente.',
      'Consulta el ticket en Estacionamiento y, durante 30 días, también desde el reflejo de la habitación.',
    ],
    caveat:
      'AROH guarda el ID Reserva como contexto, pero no administra la reserva ni reemplaza a FNSrooms.',
    route: '/caja?seccion=estacionamiento',
    anyOf: ['cash.view'],
    keywords: ['estacionamiento', 'parking', 'ticket', 'folio', 'id reserva', 'patente', 'habitacion', 'caja'],
  },
  {
    id: 'gerencia-trazabilidad',
    question: '¿Cómo leo una señal de Gerencia sin ponerme a investigar todo el módulo?',
    steps: [
      'Empieza por «Decisiones requeridas».',
      'Lee el hecho detectado y el bloque «Detalle detectado · trazabilidad directa».',
      'Revisa los valores concretos: por ejemplo #arqueo, esperado, contado, diferencia y responsable.',
      'Usa «Abrir registro» para ir directamente al objeto exacto que originó la señal.',
      'Lee la sugerencia de Fronti como apoyo; los hechos y el enlace siguen siendo la fuente verificable.',
    ],
    caveat:
      'Gerencia no debe mandarte a “buscar evidencia” manualmente. Si existe un registro concreto, la señal debe enseñarlo y enlazarlo.',
    route: '/gerencia',
    anyOf: ['management.dashboard.view'],
    keywords: ['gerencia', 'evidencia', 'trazabilidad', 'error', 'descuadre', 'fronti', 'abrir registro', 'decision'],
  },
  {
    id: 'fronti-hallazgo',
    question: '¿Qué significa cuando Fronti me avisa que detectó algo?',
    steps: [
      'Lee primero «Qué pasó»: debe describir el hecho o señal concreta que AROH detectó.',
      'Después revisa «Qué está mal / qué revisar»: Fronti explica por qué merece atención usando sólo la evidencia disponible.',
      'Abre el enlace incluido para llegar al origen de la señal.',
      'Confirma el estado real antes de ejecutar una acción sensible; Fronti no debe inventar causas, montos ni responsables.',
    ],
    caveat:
      'Fronti puede explicar y correlacionar una señal detectada, pero la detección crítica se apoya en reglas/datos del sistema. Si no hay evidencia suficiente, debe decirlo.',
    keywords: ['fronti', 'hallazgo', 'aviso', 'ia', 'que paso', 'que esta mal', 'evidencia', 'sugerencia'],
  },
  {
    id: 'fronti-consulta',
    question: '¿Qué puede consultar o hacer Fronti dentro de AROH?',
    steps: [
      'Abre Fronti desde la cabecera cuando esté habilitado para tu cuenta.',
      'Puede leer el contexto de la pantalla y consultar áreas autorizadas por tus permisos.',
      'Puede ayudarte con estado operativo, habitaciones, Caja, llaves, tareas, seguimientos, alertas y otras herramientas habilitadas.',
      'Cuando una acción modifica datos, debe respetar permisos, gates operativos y las confirmaciones que correspondan.',
    ],
    caveat:
      'Fronti hereda tus permisos efectivos; abrir el asistente no amplía lo que tu cuenta puede ver o modificar.',
    keywords: ['fronti', 'asistente', 'ia', 'preguntar', 'contexto', 'permisos', 'acciones', 'herramientas'],
  },
  {
    id: 'centro-supervision',
    question: '¿Para qué sirve el Centro de Supervisión?',
    steps: [
      'Entra a Supervisión para ver excepciones y continuidad transversal sin reemplazar los módulos de origen.',
      'Revisa pendientes, tareas vencidas, seguimientos y señales que necesitan intervención.',
      'Usa el Tablero de asignación cuando necesites distribuir o seguir trabajo.',
      'Abre el objeto original para gestionarlo cuando la acción pertenezca a Novedades, Tareas, Caja u otro módulo.',
    ],
    route: '/supervision',
    anyOf: ['supervision.center.view'],
    keywords: ['supervision', 'centro', 'tablero', 'pendientes', 'asignacion', 'control', 'excepciones'],
  },
  {
    id: 'auditoria-sorpresa',
    question: '¿Cómo creo y cierro una auditoría sorpresa?',
    steps: [
      'Entra a Supervisión > Auditorías.',
      'Crea la auditoría con el alcance y destinatarios que correspondan.',
      'Registra los resultados de cada punto revisado y los hallazgos cuando exista incumplimiento u observación.',
      'Cierra la auditoría sólo cuando el recorrido esté completo; los hallazgos pueden continuar mediante medidas correctivas.',
    ],
    route: '/supervision/auditorias',
    anyOf: ['supervision.audit.create', 'supervision.audit.close'],
    keywords: ['auditoria', 'sorpresa', 'hallazgo', 'checklist', 'control', 'cerrar', 'incumplimiento'],
  },
  {
    id: 'medida-correctiva',
    question: '¿Cómo gestiono una medida correctiva de un hallazgo?',
    steps: [
      'Abre el hallazgo desde Auditorías.',
      'Define la acción correctiva, responsable y fecha límite.',
      'Sigue su estado hasta realizada.',
      'Valida la medida sólo después de comprobar el resultado; si está vencida, Gerencia puede señalarla como riesgo abierto.',
    ],
    route: '/supervision/auditorias',
    anyOf: ['supervision.corrective.manage'],
    keywords: ['medida correctiva', 'correctiva', 'hallazgo', 'responsable', 'vencida', 'validar', 'auditoria'],
  },
  {
    id: 'informes-supervision',
    question: '¿Qué encuentro en los informes de Supervisión?',
    steps: [
      'Entra a Supervisión > Informes.',
      'Selecciona el informe y período que necesites consultar.',
      'Usa los datos consolidados como lectura del sistema; cuando necesites investigar un caso, vuelve al registro original.',
    ],
    caveat:
      'Un informe resume datos; no reemplaza la trazabilidad del objeto que produjo el dato.',
    route: '/supervision/informes',
    anyOf: ['supervision.center.view'],
    keywords: ['informes', 'supervision', 'reporte', 'periodo', 'gimnasio', 'multas', 'estado'],
  },
  {
    id: 'salud-operativa',
    question: '¿Qué significa Salud operativa?',
    steps: [
      'Entra a Supervisión > Salud operativa.',
      'Revisa señales técnicas y de flujo: fallos repetidos, tiempos, tutoriales y eventos observables.',
      'Úsala para detectar degradaciones del proceso o del sistema, no para evaluar personas.',
    ],
    route: '/supervision/salud',
    anyOf: ['supervision.center.view'],
    keywords: ['salud', 'operativa', 'errores', 'fallos', 'runtime', 'flujo', 'observabilidad', 'supervision'],
  },
  {
    id: 'rendimiento-equipo',
    question: '¿Cómo se interpreta Rendimiento sin convertirlo en un ranking?',
    steps: [
      'Entra a Supervisión > Rendimiento.',
      'Revisa cumplimiento, tiempos y continuidad sobre períodos comparables.',
      'Usa observaciones para documentar contexto cuando corresponda.',
      'Interpreta el indicador como señal de proceso y carga, no como una tabla de “mejores” y “peores”.',
    ],
    route: '/supervision/rendimiento',
    anyOf: ['supervision.performance.view'],
    keywords: ['rendimiento', 'indicadores', 'equipo', 'cumplimiento', 'tiempos', 'ranking', 'supervision'],
  },
  {
    id: 'usuario-oculto',
    question: '¿Cómo hago que un usuario opere pero no aparezca en listas y selectores?',
    steps: [
      'Entra a Administración > Usuarios y edita la cuenta.',
      'Activa la opción de usuario oculto/oculto de selectores.',
      'La cuenta conserva login, rol, permisos y operación normal.',
      'Desde ese momento deja de aparecer como opción seleccionable en turnos, responsables y directorios operativos compatibles.',
    ],
    caveat:
      'Oculto no significa desactivado. La cuenta sigue existiendo y sus acciones continúan auditadas.',
    route: '/admin/usuarios',
    anyOf: ['user.manage'],
    keywords: ['usuario', 'oculto', 'listas', 'selectores', 'turnos', 'responsable', 'visible', 'administracion'],
  },
  {
    id: 'roles-permisos-modulos',
    question: '¿Qué ocurre cuando habilito un módulo nuevo mediante Roles y permisos?',
    steps: [
      'Entra a Administración > Roles y permisos.',
      'Activa los permisos necesarios para el rol y guarda la matriz.',
      'La siguiente vez que una cuenta de ese rol entre y el módulo se vuelva visible, AROH detecta que es nuevo para esa persona.',
      'El tutorial de ese módulo aparece automáticamente y sólo enseña las funciones relacionadas con el acceso recién habilitado.',
    ],
    caveat:
      'Los tutoriales modulares quedan registrados por usuario. Cerrar sólo esta vez no lo marca como conocido; completar u omitir permanentemente sí.',
    route: '/admin/roles',
    anyOf: ['role.manage'],
    keywords: ['rol', 'roles', 'permisos', 'modulo', 'habilitar', 'activar', 'tutorial', 'usuario'],
  },
  {
    id: 'reportar-solicitar',
    question: '¿Cómo reporto un problema o solicito una función desde AROH?',
    steps: [
      'Usa «Reportar / solicitar» desde la cabecera.',
      'Describe el problema o solicitud con el contexto suficiente para reproducirlo.',
      'Adjunta capturas o archivos cuando ayuden a entender el caso.',
      'El envío queda registrado en la bandeja interna para Administración; el correo es un aviso secundario cuando está configurado.',
    ],
    caveat:
      'Los adjuntos persistentes se almacenan fuera de PostgreSQL y quedan vinculados al reporte; no se incrustan como archivos pesados dentro de Neon.',
    keywords: ['reportar', 'solicitar', 'soporte', 'problema', 'captura', 'archivo', 'funcion', 'bandeja'],
  },
  {
    id: 'bandeja-soporte',
    question: '¿Cómo reviso y resuelvo reportes o solicitudes del personal?',
    steps: [
      'Entra a Administración > Reportes y solicitudes.',
      'Abre el caso para revisar texto, contexto, usuario, fecha y adjuntos disponibles.',
      'Gestiona su estado según corresponda y deja la resolución trazada.',
      'Usa el registro interno como fuente; el correo no reemplaza la bandeja.',
    ],
    route: '/admin/soporte',
    anyOf: ['support.view', 'support.manage'],
    keywords: ['soporte', 'bandeja', 'reportes', 'solicitudes', 'adjuntos', 'resolver', 'administracion'],
  },
  {
    id: 'chat-interno',
    question: '¿Qué funciones tiene el chat interno?',
    steps: [
      'Abre el chat desde la cabecera cuando esté disponible para tu perfil operativo.',
      'Puedes conversar de forma individual o grupal, usar menciones y ver recibos/estado de escritura.',
      'El chat admite reacciones, mensajes guardados, búsqueda, GIF, imágenes, audio y stickers cuando el dispositivo/almacenamiento lo permiten.',
      'Usa enlaces a objetos de AROH cuando la conversación dependa de una novedad, tarea u otro registro: el chat no sustituye la trazabilidad.',
    ],
    caveat:
      'El chat es comunicación. Un pendiente operativo importante debe existir también como objeto trazable en el módulo que corresponda.',
    keywords: ['chat', 'mensaje', 'gif', 'audio', 'sticker', 'mencion', 'grupo', 'reaccion'],
  },
  {
    id: 'busqueda-global',
    question: '¿Cómo encuentro rápidamente un registro sin recorrer módulos?',
    steps: [
      'Usa la búsqueda global de la cabecera.',
      'Busca por #ID, habitación, huésped, responsable o texto.',
      'Abre el resultado para ir al objeto concreto.',
    ],
    caveat:
      'Los #ID operativos son globales e incrementales; sirven para citar un caso sin depender de identificadores técnicos largos.',
    route: '/buscar',
    keywords: ['buscar', 'busqueda', 'id', 'numero', 'habitacion', 'huesped', 'responsable', 'texto'],
  },
  {
    id: 'historial',
    question: '¿Dónde reviso registros ya resueltos o cerrados?',
    steps: [
      'Entra a Historial desde Novedades.',
      'Filtra o busca el objeto que necesitas consultar.',
      'Abre el registro para reconstruir su estado y continuidad sin reabrirlo por accidente.',
    ],
    route: '/historial',
    keywords: ['historial', 'cerrado', 'resuelto', 'buscar', 'antiguo', 'consulta', 'trazabilidad'],
  },
  {
    id: 'ids-humanos',
    question: '¿Qué significa el número #1234 que aparece en distintos módulos?',
    steps: [
      'Es el identificador humano global del objeto operativo.',
      'Se asigna de forma incremental y no se reutiliza.',
      'Úsalo en búsquedas, conversaciones y trazabilidad para llegar al objeto exacto sin copiar IDs técnicos.',
    ],
    keywords: ['id', 'folio', 'numero', 'correlativo', 'global', 'buscar', 'trazabilidad', '1234'],
  },
  {
    id: 'fronti-configuracion',
    question: '¿Cómo configuro Fronti y sus proveedores?',
    steps: [
      'Entra a Administración > Fronti.',
      'Revisa si Fronti y el modo proactivo están habilitados y qué proveedores están configurados.',
      'Actualiza credenciales sólo desde la interfaz segura cuando corresponda.',
      'Usa el diagnóstico para comprobar disponibilidad; las credenciales guardadas no se vuelven a mostrar en claro.',
    ],
    route: '/admin/fronti',
    anyOf: ['system.configure'],
    keywords: ['fronti', 'configurar', 'proveedor', 'groq', 'cloudflare', 'modelo', 'credencial', 'ia'],
  },
  {
    id: 'tutorial-modulo',
    question: '¿Cómo repito el tutorial de un módulo?',
    steps: [
      'Abre Ayuda desde la cabecera.',
      'Busca «Tutoriales por módulo».',
      'Pulsa el módulo que quieres volver a recorrer.',
      'AROH reabre sólo ese tutorial; el recorrido general se puede reiniciar por separado.',
    ],
    caveat:
      'Cuando un módulo se habilita por primera vez para tu cuenta, no necesitas iniciarlo manualmente: AROH lo ofrece automáticamente.',
    keywords: ['tutorial', 'modulo', 'ayuda', 'recorrido', 'repetir', 'habilitar', 'activar'],
  },
];

/** Filtra por permiso: nadie ve el procedimiento de algo que no puede hacer. */
export function visibleTopics(permissions: PermissionKey[]): HelpTopic[] {
  return HELP_TOPICS.filter(
    (topic) => !topic.anyOf || topic.anyOf.some((p) => permissions.includes(p)),
  );
}

/** Quita acentos y baja a minúsculas: en el mesón nadie escribe con tilde. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Busca un procedimiento.
 *
 * Puntúa por dónde aparece cada palabra: la pregunta pesa más que los pasos,
 * porque quien busca «caja» quiere el procedimiento de la caja, no los tres que
 * la mencionan de paso. Sin consulta devuelve todo lo visible, que es lo que
 * corresponde: la ayuda abierta debe mostrar el índice, no una pantalla vacía.
 */
export function searchHelp(query: string, permissions: PermissionKey[]): HelpTopic[] {
  const topics = visibleTopics(permissions);
  const words = fold(query).split(/\s+/).filter((word) => word.length >= 2);
  if (words.length === 0) return topics;

  const scored = topics
    .map((topic) => {
      const question = fold(topic.question);
      const keywords = topic.keywords.map(fold);
      const body = fold([...topic.steps, topic.caveat ?? ''].join(' '));

      let score = 0;
      for (const word of words) {
        if (keywords.some((keyword) => keyword.includes(word))) score += 4;
        if (question.includes(word)) score += 3;
        if (body.includes(word)) score += 1;
      }
      return { topic, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((row) => row.topic);
}

/** Pasos del tutorial del primer ingreso, según lo que la persona puede hacer. */
export function tutorialSteps(permissions: PermissionKey[]): HelpTopic[] {
  return visibleTopics(permissions).filter((topic) => topic.tutorial);
}
