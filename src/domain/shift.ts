import { ShiftStatus, ShiftType } from '@prisma/client';
import type { HandoverStatus } from '@prisma/client';
import { RuleError } from '@/server/errors';
import {
  addCalendarDateDays,
  calendarDateKey,
  hotelHour,
  hotelWallDateTime,
} from '@/domain/time';

/**
 * Máquina de estados del turno.
 *
 * Flujo nuevo:
 *   PROGRAMADO → INICIADO → ACTIVO → PREPARANDO_ENTREGA → ENTREGA_ENVIADA → CERRADO
 *
 * RECIBIDO se conserva por compatibilidad histórica, pero ya no es requisito
 * del cierre: recibir la entrega operativa y cerrar el turno son acciones
 * independientes.
 */
export const SHIFT_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  [ShiftStatus.PROGRAMADO]: [ShiftStatus.INICIADO, ShiftStatus.ANULADO],
  [ShiftStatus.INICIADO]: [ShiftStatus.ACTIVO],
  [ShiftStatus.ACTIVO]: [ShiftStatus.PREPARANDO_ENTREGA],
  [ShiftStatus.PREPARANDO_ENTREGA]: [
    ShiftStatus.ENTREGA_ENVIADA,
    ShiftStatus.ACTIVO,
  ],
  [ShiftStatus.ENTREGA_ENVIADA]: [ShiftStatus.CERRADO, ShiftStatus.RECIBIDO],
  [ShiftStatus.RECIBIDO]: [ShiftStatus.CERRADO],
  [ShiftStatus.CERRADO]: [],
  [ShiftStatus.ANULADO]: [],
};

/**
 * Estados de participación operativa activa.
 *
 * Ya no significan «bloquea abrir otro turno en el hotel». Dos turnos de
 * personas distintas pueden solaparse. La exclusividad es por persona y la
 * garantiza ShiftAssignment mediante un índice parcial en PostgreSQL.
 */
export const IN_PROGRESS_SHIFT_STATUSES: ShiftStatus[] = [
  ShiftStatus.INICIADO,
  ShiftStatus.ACTIVO,
  ShiftStatus.PREPARANDO_ENTREGA,
];

/** Alias temporal para los consumidores existentes. */
export const OCCUPYING_SHIFT_STATUSES = IN_PROGRESS_SHIFT_STATUSES;

/** Estados en los que el turno ya no admite registros operativos nuevos. */
export const FINISHED_SHIFT_STATUSES: ShiftStatus[] = [
  ShiftStatus.CERRADO,
  ShiftStatus.ANULADO,
];

/** Estados que Supervisión puede retirar del circuito sin una anulación forzada. */
export const ARCHIVABLE_SHIFT_STATUSES: ShiftStatus[] = [
  ShiftStatus.PROGRAMADO,
  ShiftStatus.CERRADO,
  ShiftStatus.ANULADO,
  ShiftStatus.RECIBIDO,
];

export const SHIFT_STATUS_LABEL: Record<ShiftStatus, string> = {
  PROGRAMADO: 'Programado',
  INICIADO: 'Iniciado',
  ACTIVO: 'Turno activo',
  PREPARANDO_ENTREGA: 'Preparando entrega',
  ENTREGA_ENVIADA: 'Entrega enviada, cierre pendiente',
  RECIBIDO: 'Recibido por el turno siguiente',
  CERRADO: 'Cerrado',
  ANULADO: 'Anulado',
};

export const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  DIA: 'Día',
  NOCHE: 'Noche',
};

export const SHIFT_SCHEDULE: Record<
  ShiftType,
  { startHour: number; endHour: number; crossesMidnight: boolean }
> = {
  DIA: { startHour: 7, endHour: 20, crossesMidnight: false },
  NOCHE: { startHour: 20, endHour: 8, crossesMidnight: true },
};

export const SHIFT_WINDOW_LABEL: Record<ShiftType, string> = {
  DIA: '07:00 a 20:00',
  NOCHE: '20:00 a 08:00',
};

export function shiftTypeAt(now = new Date()): ShiftType {
  const hour = hotelHour(now);
  return hour >= 7 && hour < 20 ? ShiftType.DIA : ShiftType.NOCHE;
}

export function canTransition(from: ShiftStatus, to: ShiftStatus): boolean {
  return (SHIFT_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: ShiftStatus, to: ShiftStatus): void {
  if (canTransition(from, to)) return;
  throw new RuleError(
    `Transición de turno no permitida: ${SHIFT_STATUS_LABEL[from]} → ${SHIFT_STATUS_LABEL[to]}.`,
  );
}

/**
 * El cierre es autónomo del turno saliente.
 *
 * La entrega debe existir y haber sido enviada. No se espera a que otro turno
 * la reciba. El estado RECIBIDO sólo se admite para compatibilidad histórica.
 */
export function assertCanClose(params: {
  status: ShiftStatus;
  handoverStatus: 'NONE' | HandoverStatus;
}): void {
  const { status, handoverStatus } = params;

  if (FINISHED_SHIFT_STATUSES.includes(status)) {
    throw new RuleError('El turno ya está cerrado.');
  }

  if (
    (status === ShiftStatus.ENTREGA_ENVIADA || status === ShiftStatus.RECIBIDO) &&
    (handoverStatus === 'ENVIADA' || handoverStatus === 'RECIBIDA')
  ) {
    return;
  }

  throw new RuleError(
    'Para cerrar el turno primero prepara la entrega, actualiza los informes, completa Caja y novedades y envía la entrega.',
  );
}

export function plannedWindow(
  date: Date,
  type: ShiftType,
): { start: Date; end: Date } {
  const schedule = SHIFT_SCHEDULE[type];

  /*
    `Shift.date` es una fecha calendario (`@db.Date`), no un instante.
    Construir la ventana con `setHours` usa la zona del proceso (UTC en
    Vercel). La hora real del turno se arma siempre en America/Santiago.
  */
  const startKey = calendarDateKey(date);
  const endDate = schedule.crossesMidnight ? addCalendarDateDays(date, 1) : date;
  const endKey = calendarDateKey(endDate);

  return {
    start: hotelWallDateTime(startKey, schedule.startHour),
    end: hotelWallDateTime(endKey, schedule.endHour),
  };
}

export function windowHours(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}
