import { ShiftStatus, ShiftType } from '@prisma/client';
import { RuleError } from '@/server/errors';

/**
 * Máquina de estados del turno.
 *
 *   PROGRAMADO → INICIADO → ACTIVO → PREPARANDO_ENTREGA → ENTREGA_ENVIADA
 *              → CERRADO
 *
 * El ciclo canónico del turno saliente termina en CERRADO **por su cuenta**,
 * después de enviar su entrega. Que otra persona reciba esa entrega más tarde
 * NO es condición para cerrar: antes lo era, y de ahí venía el atasco.
 *
 * `RECIBIDO` se conserva sólo por compatibilidad histórica: hay turnos viejos
 * con ese estado y quitarlo del enum exigiría una migración destructiva sin
 * ganancia. No es parte del flujo nuevo y nada lo exige.
 *
 * Toda transición se valida en servidor. Cualquier combinación ausente de este
 * mapa es un estado contradictorio y se rechaza.
 */
export const SHIFT_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  [ShiftStatus.PROGRAMADO]: [ShiftStatus.INICIADO, ShiftStatus.ANULADO],
  // INICIADO: el turno arrancó pero aún no recibió la caja anterior.
  [ShiftStatus.INICIADO]: [ShiftStatus.ACTIVO],
  [ShiftStatus.ACTIVO]: [ShiftStatus.PREPARANDO_ENTREGA],
  // Permite volver atrás si la entrega se preparó por error.
  [ShiftStatus.PREPARANDO_ENTREGA]: [
    ShiftStatus.ENTREGA_ENVIADA,
    ShiftStatus.ACTIVO,
  ],
  /*
    ENTREGA_ENVIADA cierra directamente. `RECIBIDO` sigue admitido como paso
    intermedio para no romper turnos históricos que quedaron ahí, pero el
    camino normal es ENTREGA_ENVIADA → CERRADO.
  */
  [ShiftStatus.ENTREGA_ENVIADA]: [ShiftStatus.CERRADO, ShiftStatus.RECIBIDO],
  [ShiftStatus.RECIBIDO]: [ShiftStatus.CERRADO],
  [ShiftStatus.CERRADO]: [],
  [ShiftStatus.ANULADO]: [],
};

/**
 * Estados en los que el turno está EN CURSO.
 *
 * **Ya no bloquea abrir otro turno.** Varios turnos pueden estar en curso a la
 * vez: el saliente preparando su entrega y el entrante ya operando. Lo que no
 * puede repetirse es una *persona*, y eso lo garantiza el índice único parcial
 * `ShiftAssignment_participacion_activa_por_usuario`, no esta lista.
 *
 * `ENTREGA_ENVIADA` queda fuera: ese turno ya no está en el mesón, está
 * esperando cerrarse.
 */
export const IN_PROGRESS_SHIFT_STATUSES: ShiftStatus[] = [
  ShiftStatus.INICIADO,
  ShiftStatus.ACTIVO,
  ShiftStatus.PREPARANDO_ENTREGA,
];

/**
 * Nombre anterior de `IN_PROGRESS_SHIFT_STATUSES`.
 *
 * Se conserva porque el nombre viejo decía «ocupa el mesón, nadie más puede
 * abrir», y eso ya no es cierto. Queda como alias para no tocar llamadores que
 * sólo preguntan «¿está en curso?».
 *
 * @deprecated Usa `IN_PROGRESS_SHIFT_STATUSES`.
 */
export const OCCUPYING_SHIFT_STATUSES = IN_PROGRESS_SHIFT_STATUSES;

/** Estados en los que el turno ya no admite registros operativos nuevos. */
export const FINISHED_SHIFT_STATUSES: ShiftStatus[] = [
  ShiftStatus.CERRADO,
  ShiftStatus.ANULADO,
];

export const SHIFT_STATUS_LABEL: Record<ShiftStatus, string> = {
  PROGRAMADO: 'Programado',
  INICIADO: 'Iniciado',
  ACTIVO: 'Turno activo',
  PREPARANDO_ENTREGA: 'Preparando entrega',
  ENTREGA_ENVIADA: 'Cierre enviado, esperando recepción',
  RECIBIDO: 'Recibido por el turno siguiente',
  CERRADO: 'Cerrado',
  ANULADO: 'Anulado',
};

export const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  DIA: 'Día',
  NOCHE: 'Noche',
};

/**
 * Las DOS ventanas del hotel, y son fijas.
 *
 * Día 07:00–19:59 y noche 20:00–07:59. No hay un tercer turno ni ventanas a
 * medida: el hotel trabaja así todos los días, y un horario configurable era
 * complejidad que nadie pidió.
 *
 * El fin se expresa como la hora en que empieza el otro turno (20 y 8), de modo
 * que las dos ventanas se tocan sin dejar un minuto sin cubrir. Lo que se
 * MUESTRA es 19:59, porque a las 20:00 ya es el turno de noche.
 */
export const SHIFT_SCHEDULE: Record<
  ShiftType,
  { startHour: number; endHour: number; crossesMidnight: boolean }
> = {
  DIA: { startHour: 7, endHour: 20, crossesMidnight: false },
  NOCHE: { startHour: 20, endHour: 8, crossesMidnight: true },
};

/** Cómo se lee la ventana en pantalla: el último minuto que cubre. */
export const SHIFT_WINDOW_LABEL: Record<ShiftType, string> = {
  DIA: '07:00 a 19:59',
  NOCHE: '20:00 a 07:59',
};

/**
 * Qué turno corresponde a un momento dado.
 *
 * Sirve para proponer el tipo al crearlo —nadie debería tener que pensarlo a
 * las tres de la mañana— pero **no obliga**: quien crea el turno elige.
 */
export function shiftTypeAt(now = new Date()): ShiftType {
  const hour = now.getHours();
  return hour >= 7 && hour < 20 ? ShiftType.DIA : ShiftType.NOCHE;
}

export function canTransition(from: ShiftStatus, to: ShiftStatus): boolean {
  return (SHIFT_TRANSITIONS[from] ?? []).includes(to);
}

/** Valida la transición o explica por qué es imposible, en lenguaje operativo. */
export function assertTransition(from: ShiftStatus, to: ShiftStatus): void {
  if (canTransition(from, to)) return;
  throw new RuleError(
    `Transición de turno no permitida: ${SHIFT_STATUS_LABEL[from]} → ${SHIFT_STATUS_LABEL[to]}.`,
  );
}

/**
 * Regla de cierre.
 *
 * Un cierre operativo recorre la misma secuencia de siempre: preparar la
 * entrega, actualizar los informes, cuadrar la caja, revisar novedades y
 * enviarla. Lo que cambia es el final: **el turno cierra por su cuenta en
 * cuanto su entrega está enviada.**
 *
 * Antes había que esperar a que otra persona la recibiera, y eso paralizaba el
 * cierre cuando nadie llegaba a recibir o cuando el relevo tardaba. Recibir la
 * caja es asunto del turno entrante; cerrar es asunto del saliente. Que la
 * entrega ya esté recibida tampoco estorba: también cierra.
 *
 * El cierre directo desde ACTIVO sigue prohibido: abriría una ruta capaz de
 * saltarse el arqueo, los informes y las novedades. Un turno abierto por error
 * se resuelve desde Administración con retirada o anulación auditada.
 */
export function assertCanClose(params: {
  status: ShiftStatus;
  handoverStatus: 'NONE' | 'BORRADOR' | 'ENVIADA' | 'RECIBIDA';
}): void {
  const { status, handoverStatus } = params;

  if (FINISHED_SHIFT_STATUSES.includes(status)) {
    throw new RuleError('El turno ya está cerrado.');
  }

  if (handoverStatus === 'ENVIADA' || handoverStatus === 'RECIBIDA') {
    assertTransition(status, ShiftStatus.CERRADO);
    return;
  }

  throw new RuleError(
    'Para cerrar el turno primero prepara la entrega, actualiza los informes, cuadra la caja, revisa las novedades y envíala.',
  );
}

/** Fechas de inicio/fin a partir de la fecha operativa y el tipo. */
export function plannedWindow(
  date: Date,
  type: ShiftType,
): { start: Date; end: Date } {
  const schedule = SHIFT_SCHEDULE[type];
  const start = new Date(date);
  start.setHours(schedule.startHour, 0, 0, 0);
  const end = new Date(date);
  end.setHours(schedule.endHour, 0, 0, 0);
  if (schedule.crossesMidnight) end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Horas que abarca una ventana ya calculada. Sirve para mostrarla. */
export function windowHours(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}
