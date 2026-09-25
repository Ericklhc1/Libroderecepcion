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
      'Si el turno saliente todavía está activo o cerrando, espera: el sistema no permite abrir el entrante en paralelo.',
      'Cuando el saliente quede cerrado, pulsa «Abrir mi turno». Si existe una entrega pendiente, tu turno queda iniciado pero todavía bloqueado.',
      'Recuenta Caja, valida físicamente las garantías y confirma la recepción de la entrega.',
      'Al confirmar la recepción, tu turno pasa a activo y se habilita la operación.',
    ],
    caveat:
      'Recepción sólo puede operar con un turno ACTIVO. Sin turno, durante la recepción y durante el cierre, Novedades, Caja operativa y Llaves quedan bloqueadas.',
    route: '/turno',
    anyOf: ['shift.start'],
    keywords: ['turno', 'iniciar', 'abrir', 'recibir', 'relevo', 'caja', 'recontar', 'firma', 'bloqueado', 'entrar'],
    tutorial: true,
  },

  {
    id: 'recibir-caja',
    question: '¿Cómo recibo la Caja y valido el relevo?',
    steps: [
      'El recepcionista saliente debe haber cerrado formalmente su turno.',
      'Abre tu turno: si hay una entrega pendiente, quedarás en estado de recepción y no podrás operar todavía.',
      'Abre la entrega y recuenta el efectivo físicamente por denominación.',
      'Valida las garantías bajo custodia como elementos separados del conteo del fondo.',
      'Confirma la recepción del turno. Sólo entonces tu turno queda activo.',
      'Cuando la recepción esté confirmada, imprime el acta de entrega/recepción para la firma del saliente y del entrante.',
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
      'Revisa los pendientes reales de Recepción y completa el cierre de Caja.',
      'Prepara y revisa la entrega; agrega sólo las notas manuales que el sistema no pueda conocer.',
      'Envía la entrega y cierra formalmente tu turno.',
      'El recepcionista entrante recién entonces podrá abrir el suyo, recontar Caja y confirmar la recepción.',
      'Tras la recepción, imprime el acta para las firmas de saliente y entrante; Supervisión o auditoría valida el cierre posteriormente.',
    ],
    caveat:
      'Enviar la entrega no libera al saliente. La participación termina únicamente al cerrar formalmente el turno. El entrante no puede operar hasta validar la recepción.',
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
      'Usa «Nueva garantía» para registrar el dinero bajo custodia.',
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
