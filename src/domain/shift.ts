import { ShiftStatus, ShiftType } from '@prisma/client';
import { RuleError } from '@/server/errors';

/**
 * Máquina de estados del turno.
 *
 *   PROGRAMADO → INICIADO → ACTIVO → PREPARANDO_ENTREGA → ENTREGA_ENVIADA
 *              → RECIBIDO → CERRADO
 *
 * Toda transición se valida en servidor. Cualquier combinación ausente de este
 * mapa es un estado contradictorio y se rechaza.
 */
export const SHIFT_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  [ShiftStatus.PROGRAMADO]: [ShiftStatus.INICIADO, ShiftStatus.ANULADO],
  // INICIADO: el turno arrancó pero aún no confirmó la entrega anterior.
  [ShiftStatus.INICIADO]: [ShiftStatus.ACTIVO],
  [ShiftStatus.ACTIVO]: [ShiftStatus.PREPARANDO_ENTREGA, ShiftStatus.CERRADO],
  // Permite volver atrás si la entrega se preparó por error.
  [ShiftStatus.PREPARANDO_ENTREGA]: [
    ShiftStatus.ENTREGA_ENVIADA,
    ShiftStatus.ACTIVO,
  ],
  [ShiftStatus.ENTREGA_ENVIADA]: [ShiftStatus.RECIBIDO],
  [ShiftStatus.RECIBIDO]: [ShiftStatus.CERRADO],
  [ShiftStatus.CERRADO]: [],
  [ShiftStatus.ANULADO]: [],
};

/** Estados en los que el turno ocupa al usuario y bloquea abrir otro. */
export const OCCUPYING_SHIFT_STATUSES: ShiftStatus[] = [
  ShiftStatus.INICIADO,
  ShiftStatus.ACTIVO,
  ShiftStatus.PREPARANDO_ENTREGA,
];

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
  ENTREGA_ENVIADA: 'Entrega enviada',
  RECIBIDO: 'Recibido por siguiente turno',
  CERRADO: 'Cerrado',
  ANULADO: 'Anulado',
};

export const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  MANANA: 'Mañana',
  TARDE: 'Tarde',
  NOCHE: 'Noche',
};

/** Horario nominal de cada turno (hora local del hotel). */
export const SHIFT_SCHEDULE: Record<
  ShiftType,
  { startHour: number; endHour: number; crossesMidnight: boolean }
> = {
  MANANA: { startHour: 7, endHour: 15, crossesMidnight: false },
  TARDE: { startHour: 15, endHour: 23, crossesMidnight: false },
  NOCHE: { startHour: 23, endHour: 7, crossesMidnight: true },
};

const ORDER: ShiftType[] = [ShiftType.MANANA, ShiftType.TARDE, ShiftType.NOCHE];

export function shiftOrder(type: ShiftType): number {
  return ORDER.indexOf(type);
}

/** Turno que sigue en la secuencia; `dayOffset` = 1 al pasar de NOCHE a MAÑANA. */
export function nextShiftSlot(type: ShiftType): {
  type: ShiftType;
  dayOffset: number;
} {
  const index = shiftOrder(type);
  const next = ORDER[(index + 1) % ORDER.length];
  if (!next) throw new RuleError('Tipo de turno desconocido.');
  return { type: next, dayOffset: index === ORDER.length - 1 ? 1 : 0 };
}

export function previousShiftSlot(type: ShiftType): {
  type: ShiftType;
  dayOffset: number;
} {
  const index = shiftOrder(type);
  const prevIndex = (index - 1 + ORDER.length) % ORDER.length;
  const prev = ORDER[prevIndex];
  if (!prev) throw new RuleError('Tipo de turno desconocido.');
  return { type: prev, dayOffset: index === 0 ? -1 : 0 };
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
 * Regla de cierre: un turno no puede cerrarse sin haber entregado cuando
 * existe un turno siguiente que debe recibir.
 */
export function assertCanClose(params: {
  status: ShiftStatus;
  hasNextShift: boolean;
  handoverStatus: 'NONE' | 'BORRADOR' | 'ENVIADA' | 'RECIBIDA';
}): void {
  const { status, hasNextShift, handoverStatus } = params;

  if (FINISHED_SHIFT_STATUSES.includes(status)) {
    throw new RuleError('El turno ya está cerrado.');
  }

  if (hasNextShift) {
    if (handoverStatus === 'NONE' || handoverStatus === 'BORRADOR') {
      throw new RuleError(
        'No puedes cerrar el turno sin enviar la entrega al turno siguiente.',
      );
    }
    if (handoverStatus === 'ENVIADA') {
      throw new RuleError(
        'La entrega fue enviada pero el turno siguiente aún no la confirma. El turno se cierra una vez recibida.',
      );
    }
    assertTransition(status, ShiftStatus.CERRADO);
    return;
  }

  // Sin turno siguiente programado: se permite cerrar desde ACTIVO o RECIBIDO.
  if (status !== ShiftStatus.ACTIVO && status !== ShiftStatus.RECIBIDO) {
    throw new RuleError(
      `No puedes cerrar un turno en estado ${SHIFT_STATUS_LABEL[status]}.`,
    );
  }
}

/** Fechas nominales de inicio/fin a partir de la fecha operativa y el tipo. */
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
