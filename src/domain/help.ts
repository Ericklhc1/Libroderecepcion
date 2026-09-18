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
 * También es la fuente del **tutorial guiado**: el recorrido del primer
 * ingreso no repite estos textos, los reutiliza.
 *
 * `action` es lo único que ejecuta. Sólo acciones **reversibles**: reconciliar
 * llaves es idempotente, regenerar el borrador de una entrega no destruye las
 * notas manuales. Confirmar una salida, un check-in o un arqueo NO están acá y
 * no deben estarlo: esas las firma una persona.
 */

/** Acciones que la ayuda puede ejecutar. Todas reversibles, sin excepción. */
export type HelpActionKey = 'reconciliar-llaves' | 'regenerar-entrega';

export const HELP_ACTIONS: Record<
  HelpActionKey,
  { label: string; permission: PermissionKey; explains: string }
> = {
  'reconciliar-llaves': {
    label: 'Reconciliar el inventario de llaves',
    permission: 'key.stock',
    explains:
      'Entrega cada llave principal a quien está dentro de su habitación. Es idempotente: ' +
      'correrlo dos veces da el mismo resultado, y no le quita la llave a nadie.',
  },
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
    question: '¿Cómo tomo un turno?',
    steps: [
      'Entra a Turno.',
      'Los turnos no se reparten de antemano: aparece la franja que corresponde al reloj.',
      'Si el turno anterior dejó una entrega pendiente, aparece primero y destacada.',
      'Abre o toma el turno y confirma la recepción cuando Caja y elementos estén conformes.',
    ],
    caveat:
      'Si dos personas pulsan a la vez, la segunda recibe un aviso: el turno queda de quien ' +
      'llegó primero, no se lo quita nadie.',
    route: '/turno',
    anyOf: ['shift.start'],
    keywords: ['turno', 'iniciar', 'tomar', 'empezar', 'jornada', 'entrar'],
    tutorial: true,
  },
  {
    id: 'cargar-informes',
    question: '¿Dónde subo los tres informes del PMS?',
    steps: [
      'Entra a Turno: la primera tarjeta es la de los informes.',
      'Para el cierre adjunta Actividad, In house y Salidas. Entradas puede seguir usándose para otros flujos, pero no sustituye ninguno de esos tres.',
      'Revisa la propuesta antes de aplicarla: nada se sobrescribe sin que alguien lo vea.',
      'Aplica. De ahí sale el estado de las 89 habitaciones, la cola y las llaves.',
    ],
    caveat:
      'La fecha del lote sale del propio informe, no del reloj: cargar los de ayer no da el ' +
      'día por cubierto, y el sistema lo dice.',
    route: '/turno',
    anyOf: ['pms.import'],
    keywords: ['informe', 'pms', 'pdf', 'subir', 'cargar', 'actividad', 'entradas', 'salidas', 'in house'],
    tutorial: true,
  },
  {
    id: 'recibir-caja',
    question: '¿Cómo recibo la caja al entrar al turno?',
    steps: [
      'Al tomar el turno, abre la entrega que dejó el turno anterior.',
      'Cuenta el efectivo por denominación, billete por billete.',
      'Confirma los elementos que recibes: llaves maestras, radio, objetos olvidados.',
      'Recién entonces confirma la recepción del turno.',
    ],
    caveat:
      'Si tu recuento no coincide con lo declarado, la diferencia queda registrada y visible. ' +
      'No la escondas: es justamente para eso.',
    route: '/turno',
    anyOf: ['shift.receive'],
    keywords: ['caja', 'arqueo', 'fondo', 'efectivo', 'recibir', 'contar', 'dinero', 'divisa'],
    tutorial: true,
  },
  {
    id: 'entregar-turno',
    question: '¿Cómo entrego mi turno?',
    steps: [
      'En Turno, pulsa preparar la entrega: el resumen se genera solo.',
      'Agrega las notas que el sistema no puede saber, clasificadas por urgencia.',
      'Cuenta la caja y declara los elementos.',
      'Envía la entrega. El turno siguiente la confirma; esa recepción cierra automáticamente tu turno con la hora real.',
    ],
    caveat:
      'No existe un botón operativo separado para «Cerrar turno»: el cierre saliente ocurre al recibir el relevo. ' +
      'Si la caja no cuadra con el fondo fijo, la diferencia se resuelve o documenta antes de entregar.',
    route: '/turno',
    anyOf: ['shift.handover'],
    keywords: ['entregar', 'entrega', 'cerrar', 'turno', 'resumen', 'traspaso'],
    action: 'regenerar-entrega',
    tutorial: true,
  },
  {
    /*
      Este procedimiento NO lleva `anyOf`: lo ve todo el mundo, y es a
      propósito. Lo encontró una prueba en navegador: un recepcionista que
      buscaba «no deja confirmar» recibía «¿Cómo tomo un turno?», porque el
      reseteo está filtrado por un permiso que él no tiene. Quien está
      atascado necesita saber qué hacer, aunque no sea él quien lo resuelva.
    */
    id: 'atascado-sin-permiso',
    question: 'No me deja confirmar y no tengo el botón de resetear. ¿A quién aviso?',
    steps: [
      'Mira la ficha de la habitación: si el mismo huésped aparece como «Actual» y como «Entrante», es una duplicidad del informe.',
      'Avisa a tu Supervisor o al Administrador de sistema: ellos tienen el botón «Resetear la habitación».',
      'Mientras tanto, registra una incidencia con la habitación como contexto para que quede el rastro.',
    ],
    caveat:
      'No fuerces nada por otro camino: la habitación queda peor y el rastro se pierde.',
    route: '/habitaciones',
    keywords: [
      'no deja', 'no puedo', 'atascada', 'bloqueada', 'duplicada', 'duplicidad',
      'confirmar', 'error', 'check-in', 'check-out', 'aviso', 'supervisor',
    ],
  },
  {
    id: 'habitacion-atascada',
    question: 'No me deja confirmar un check-in o un check-out. ¿Qué hago?',
    steps: [
      'Abre la ficha de la habitación.',
      'Mira si el mismo huésped aparece a la vez como «Actual» y como «Entrante».',
      'Si es así, es una duplicidad del informe: pulsa «Resetear la habitación».',
      'Escribe qué no te dejaba confirmar. Queda en la auditoría.',
    ],
    caveat:
      'El reseteo conserva una estadía por reserva —la más avanzada— y devuelve las llaves ' +
      'sueltas al inventario. Si no hay duplicidad, no toca nada y lo dice.',
    route: '/habitaciones',
    anyOf: ['room.reset'],
    keywords: [
      'atascada', 'duplicada', 'duplicidad', 'no deja', 'confirmar', 'resetear',
      'bloqueada', 'error', 'check-in', 'check-out',
    ],
  },
  {
    id: 'llaves-sin-asignar',
    question: 'Las llaves no aparecen asignadas a nadie. ¿Cómo lo arreglo?',
    steps: [
      'Entra a Llaves.',
      'Pulsa «Reconciliar con las estadías».',
      'Cada llave principal queda con quien está dentro de su habitación.',
    ],
    caveat:
      'Pasa cuando se cargaron estadías antes de que existiera la regla. Es idempotente: ' +
      'correrlo de nuevo no rompe nada.',
    route: '/llaves',
    anyOf: ['key.stock'],
    keywords: ['llave', 'llaves', 'asignar', 'reconciliar', 'inventario', 'disponible'],
    action: 'reconciliar-llaves',
  },
  {
    id: 'garantia',
    question: '¿Cómo registro o resuelvo una garantía?',
    steps: [
      'Entra a Huéspedes y reservas.',
      'Busca la reserva y usa «Agregar garantía» para registrarla.',
      'Para cerrarla, usa «Resolver» y elige qué pasó: devuelta, aplicada, multa o cerrada.',
    ],
    caveat:
      'Sólo se ofrecen los estados a los que la garantía puede pasar desde donde está. Una ' +
      'garantía aplicada en parte exige monto y motivo.',
    route: '/huespedes',
    anyOf: ['guest.manage'],
    keywords: ['garantía', 'garantia', 'deposito', 'tarjeta', 'multa', 'devolver'],
  },
  {
    id: 'incidencia',
    question: '¿Cómo registro una incidencia?',
    steps: [
      'Desde cualquier pantalla, usa «Nueva incidencia» en la barra de acciones.',
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
