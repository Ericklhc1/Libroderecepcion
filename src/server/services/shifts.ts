import 'server-only';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  AssignmentRole,
  AuditAction,
  HandoverLevel,
  HandoverStatus,
  NotificationType,
  Priority,
  ShiftStatus,
  TaskOrigin,
} from '@prisma/client';
// `ShiftType` sólo se usa como tipo: los valores los da `shiftTypeAt`.
import type { Prisma, ShiftType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate } from '@/lib/format';
import { addCalendarDateDays, calendarDateKey, hotelCalendarDate } from '@/domain/time';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { assertShiftAssignable } from '@/server/services/users';
import { notify } from '@/server/notifications';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  OCCUPYING_SHIFT_STATUSES,
  SHIFT_EMERGENCY_REASON_LABEL,
  SHIFT_TYPE_LABEL,
  SHIFT_WINDOW_LABEL,
  isShiftEmergencyReason,
  assertCanClose,
  assertTransition,
  plannedWindow,
  shiftTypeAt,
  type ShiftEmergencyReason,
} from '@/domain/shift';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { fromMinor } from '@/domain/cash';
import { buildHandoverSnapshot, SNAPSHOT_SECTION_ORDER } from './handover-snapshot';
import { LIVE_ALERT_WHERE } from './alert-engine';
import {
  cashBlockersForReceiving,
  cashBlockersForSending,
  confirmHandoverCash,
  ensureHandoverElements,
  isCashAlreadyReceived,
  isCashEnabled,
} from './cash';
import { assertShiftCashClosed } from './cash-closure';
import { cancelShiftTimers } from './operational-alarms';
import {
  RECEPTION_BACKUP_EMAIL,
  SUPERVISION_BACKUP_EMAIL,
  operationalMailTimestamp,
  queueOperationalMail,
} from './operational-mail';

/** Fecha operativa del hotel, guardada como `@db.Date` estable. */
export function operationalDate(now = new Date()): Date {
  return hotelCalendarDate(now);
}

/**
 * Fecha operativa canónica de Recepción.
 *
 * El cambio de día no lo decide la medianoche ni un informe importado:
 * lo decide el ciclo real de turnos. Mientras exista un turno operativo,
 * su `Shift.date` manda. Entre turnos, el último cierre determina la fecha
 * siguiente: cerrar NOCHE abre el día calendario siguiente; cerrar DÍA
 * conserva la misma fecha para el turno nocturno.
 */
export async function resolveOperationalBusinessDate(now = new Date()): Promise<Date> {
  const activeShift = await prisma.shift.findFirst({
    where: {
      archivedAt: null,
      status: {
        in: [
          ShiftStatus.INICIADO,
          ShiftStatus.ACTIVO,
          ShiftStatus.PREPARANDO_ENTREGA,
          ShiftStatus.ENTREGA_ENVIADA,
        ],
      },
    },
    select: { date: true },
    orderBy: [{ actualStart: 'desc' }, { createdAt: 'desc' }],
  });
  if (activeShift) return activeShift.date;

  const lastClosedShift = await prisma.shift.findFirst({
    where: {
      archivedAt: null,
      status: ShiftStatus.CERRADO,
      actualEnd: { not: null },
    },
    select: { date: true, type: true },
    orderBy: { actualEnd: 'desc' },
  });

  if (!lastClosedShift) return hotelCalendarDate(now);
  return lastClosedShift.type === 'NOCHE'
    ? addCalendarDateDays(lastClosedShift.date, 1)
    : lastClosedShift.date;
}

export const shiftInclude = {
  assignments: { include: { user: { select: { id: true, name: true, username: true } } } },
  handoverOut: {
    include: {
      issuedBy: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
    },
  },
} satisfies Prisma.ShiftInclude;

export type ShiftWithDetail = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;


const CLOSURE_VALIDATOR_USERNAME = 'EHerrera';

async function ensureClosureValidationTask(
  tx: Prisma.TransactionClient,
  shiftId: string,
  createdById: string,
) {
  const [alert, validator] = await Promise.all([
    tx.alert.findUnique({
      where: { dedupeKey: `shift-validation:${shiftId}` },
      select: { id: true, title: true, message: true },
    }),
    tx.user.findFirst({
      where: {
        username: { equals: CLOSURE_VALIDATOR_USERNAME, mode: 'insensitive' },
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    }),
  ]);

  if (!alert || !validator) return;

  const existing = await tx.task.findFirst({
    where: { alertId: alert.id, deletedAt: null },
    select: { id: true },
  });

  if (existing) {
    await tx.task.update({
      where: { id: existing.id },
      data: {
        assigneeId: validator.id,
        priority: Priority.CRITICA,
        origin: TaskOrigin.ALERTA,
      },
    });
    return;
  }

  await tx.task.create({
    data: {
      title: 'Validar cierre de turno',
      description:
        alert.message ??
        'Revisión posterior obligatoria del cierre: Caja, pendientes, entrega y trazabilidad.',
      status: 'PENDIENTE',
      priority: Priority.CRITICA,
      origin: TaskOrigin.ALERTA,
      assigneeId: validator.id,
      createdById,
      shiftId,
      alertId: alert.id,
      tags: ['cierre-turno', 'validacion-jefatura'],
    },
  });
}

/**
 * Turno que el usuario tiene abierto ahora mismo, si alguno.
 *
 * Incluye `ENTREGA_ENVIADA` porque quien entregó sigue siendo responsable de su
 * turno hasta que alguien lo reciba: tiene que poder verlo y corregirlo.
 */
export async function getMyOpenShift(userId: string) {
  return prisma.shift.findFirst({
    where: {
      status: { in: [...OCCUPYING_SHIFT_STATUSES, ShiftStatus.ENTREGA_ENVIADA] },
      assignments: {
        some: {
          userId,
          activatedAt: { not: null },
          leftAt: null,
        },
      },
    },
    include: shiftInclude,
    orderBy: [{ date: 'desc' }, { actualStart: 'desc' }],
  });
}

/** Participación operativa real: es la que impide entrar simultáneamente en otro turno. */
export async function getMyActiveShift(userId: string) {
  return prisma.shift.findFirst({
    where: {
      status: { in: [...OCCUPYING_SHIFT_STATUSES, ShiftStatus.ENTREGA_ENVIADA] },
      assignments: {
        some: {
          userId,
          activatedAt: { not: null },
          leftAt: null,
        },
      },
    },
    include: shiftInclude,
    orderBy: [{ actualStart: 'desc' }, { createdAt: 'desc' }],
  });
}

/** Turno ya entregado que la persona sigue participando activamente y aún debe cerrar. */
export async function getMyPendingClosureShift(userId: string) {
  return prisma.shift.findFirst({
    where: {
      status: ShiftStatus.ENTREGA_ENVIADA,
      assignments: {
        some: {
          userId,
          activatedAt: { not: null },
          leftAt: null,
        },
      },
      archivedAt: null,
    },
    include: shiftInclude,
    orderBy: [{ updatedAt: 'desc' }],
  });
}

export async function endShiftParticipation(
  tx: Prisma.TransactionClient,
  shiftId: string,
  at: Date,
): Promise<void> {
  await tx.shiftAssignment.updateMany({
    where: {
      shiftId,
      activatedAt: { not: null },
      leftAt: null,
    },
    data: { leftAt: at },
  });
}

/**
 * ============================ TURNOS: EL MODELO =============================
 *
 * Tres reglas, y las tres nacen de un atasco real en producción.
 *
 * 1. **Dos ventanas fijas**: día [07:00,20:00) y noche [20:00,08:00). Viven en
 *    `domain/shift.ts`.
 *
 * 2. **Los turnos NO se programan de antemano.** Se crean cuando alguien entra
 *    al mesón. Antes había que programarlos, y de eso venía el atasco: para
 *    recibir una entrega el sistema buscaba «el turno de la franja anterior»
 *    por (fecha, tipo), y si nadie había programado esa franja no encontraba
 *    nada que recibir ni podía cerrar. La adyacencia entre franjas **se
 *    eliminó**: ya no existe `nextShiftSlot` ni `previousShiftSlot`.
 *
 * 3. **El relevo de Recepción es secuencial.** El saliente mantiene su
 *    participación hasta cerrar formalmente. Recién entonces el entrante puede
 *    abrir, recontar Caja y confirmar la entrega antes de quedar ACTIVO.
 */

/** Turno operativo en curso. El servicio de apertura garantiza uno a la vez en Recepción. */
export async function getCurrentShift(): Promise<ShiftWithDetail | null> {
  return prisma.shift.findFirst({
    where: {
      archivedAt: null,
      status: { in: OCCUPYING_SHIFT_STATUSES },
      assignments: {
        some: {
          activatedAt: { not: null },
          leftAt: null,
        },
      },
    },
    include: shiftInclude,
    orderBy: [{ actualStart: 'desc' }, { createdAt: 'desc' }],
  });
}

/**
 * Turnos que ya enviaron su cierre y esperan a que alguien lo reciba.
 *
 * Es «la bandeja». Normalmente hay cero o uno; puede haber más si alguien
 * entregó y nadie recibió durante varios relevos, y en ese caso hay que verlos
 * todos en lugar de esconder los viejos.
 */
export async function getShiftsAwaitingReceipt(): Promise<ShiftWithDetail[]> {
  return prisma.shift.findMany({
    where: {
      archivedAt: null,
      status: ShiftStatus.CERRADO,
      handoverOut: {
        is: {
          status: HandoverStatus.ENVIADA,
          receivedAt: null,
        },
      },
    },
    include: shiftInclude,
    orderBy: [{ actualEnd: 'asc' }, { updatedAt: 'asc' }],
  });
}

/**
 * La entrega que está esperando ser recibida.
 *
 * Reemplaza a `getIncomingHandover(shift)`, que deducía el turno anterior por
 * adyacencia de franjas y devolvía `null` en cuanto la cadena tenía un hueco.
 * Ahora no hay nada que deducir: la entrega pendiente es simplemente la que
 * está enviada y sin recibir después del cierre saliente.
 *
 * `exceptShiftId` evita que un turno se reciba a sí mismo.
 */
export async function getPendingHandover(targetShiftId?: string | null) {
  return prisma.shiftHandover.findFirst({
    where: {
      status: HandoverStatus.ENVIADA,
      receivedAt: null,
      fromShift: { status: ShiftStatus.CERRADO },
      ...(targetShiftId ? { fromShiftId: { not: targetShiftId } } : {}),
      ...(targetShiftId
        ? { OR: [{ toShiftId: null }, { toShiftId: targetShiftId }] }
        : { toShiftId: null }),
    },
    include: {
      issuedBy: { select: { id: true, name: true } },
      fromShift: true,
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
    },
    orderBy: { issuedAt: 'asc' },
  });
}

/**
 * Caja declarada que todavía no fue recibida.
 *
 * Sólo se ofrece cuando la entrega ya fue ENVIADA. El entrante no puede
 * reclamar ni recontar la Caja mientras el saliente siga preparando el cierre.
 */
export async function getPendingCashHandover(targetShiftId?: string | null) {
  return prisma.shiftHandover.findFirst({
    where: {
      status: HandoverStatus.ENVIADA,
      fromShift: { status: ShiftStatus.CERRADO },
      ...(targetShiftId ? { fromShiftId: { not: targetShiftId } } : {}),
      ...(targetShiftId
        ? { OR: [{ toShiftId: null }, { toShiftId: targetShiftId }] }
        : { toShiftId: null }),
      cashCounts: {
        some: { kind: 'DECLARADO' },
        none: { kind: 'CONFIRMADO' },
      },
    },
    include: {
      issuedBy: { select: { id: true, name: true } },
      fromShift: true,
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Lo que la pantalla de turno necesita saber de una vez.
 *
 * Un solo objeto en lugar de una lista de franjas tomables: con un turno a la
 * vez, la pregunta ya no es «cuál tomo» sino «hay uno abierto y estoy dentro».
 */
export type ShiftDesk = {
  /** El turno propio del usuario, si está participando. */
  current: ShiftWithDetail | null;
  /** Turno operativo global vigente, aunque el usuario todavía no esté dentro. */
  operationalCurrent: ShiftWithDetail | null;
  /** Si el usuario es parte del turno en curso. */
  iAmIn: boolean;
  /** Entrega operativa esperando recepción. */
  pending: Awaited<ReturnType<typeof getPendingHandover>>;
  /** Caja declarada del turno saliente cerrado, pendiente de recuento entrante. */
  cashPending: Awaited<ReturnType<typeof getPendingCashHandover>>;
  /** Turnos que entregaron y esperan a alguien. */
  awaitingReceipt: ShiftWithDetail[];
  /** Tipo sugerido para un turno nuevo, según el reloj. */
  suggestedType: ShiftType;
  suggestedWindow: string;
};

export async function getShiftDesk(user: CurrentUser): Promise<ShiftDesk> {
  const [current, operationalCurrent, awaitingReceipt] = await Promise.all([
    getMyActiveShift(user.id),
    getCurrentShift(),
    getShiftsAwaitingReceipt(),
  ]);
  const [pending, cashPending] = await Promise.all([
    getPendingHandover(current?.id ?? null),
    getPendingCashHandover(current?.id ?? null),
  ]);
  const suggestedType = shiftTypeAt();

  return {
    current,
    operationalCurrent,
    iAmIn: Boolean(current),
    pending,
    cashPending,
    awaitingReceipt,
    suggestedType,
    suggestedWindow: SHIFT_WINDOW_LABEL[suggestedType],
  };
}

export async function getShiftById(shiftId: string): Promise<ShiftWithDetail> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: shiftInclude,
  });
  if (!shift) throw new NotFoundError('El turno no existe.');
  return shift;
}

/**
 * Información que se muestra al iniciar turno: qué está pasando y qué se hereda.
 */
export async function getShiftBriefing(shift: { id: string; date: Date; type: ShiftType }) {
  const now = new Date();
  const [incoming, openEntries, overdueTasks, myTasks, alerts, followUps] =
    await Promise.all([
      getPendingHandover(shift.id),
      prisma.operationalEntry.findMany({
        where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
        include: {
          owner: { select: { id: true, name: true } },
          department: { select: { name: true } },
        },
        orderBy: [{ priority: 'desc' }, { occurredAt: 'desc' }],
        take: 25,
      }),
      prisma.task.findMany({
        where: {
          deletedAt: null,
          status: { in: TASK_OPEN_STATUSES },
          dueAt: { lt: now },
        },
        include: { assignee: { select: { id: true, name: true } } },
        orderBy: { dueAt: 'asc' },
        take: 25,
      }),
      prisma.task.findMany({
        where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
        include: { assignee: { select: { id: true, name: true } } },
        orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
        take: 25,
      }),
      prisma.alert.findMany({
        where: LIVE_ALERT_WHERE(now),
        orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
        take: 25,
      }),
      prisma.followUp.findMany({
        where: {
          deletedAt: null,
          status: { in: ['PENDIENTE', 'VENCIDO'] },
        },
        include: {
          owner: { select: { id: true, name: true } },
          entry: { select: { id: true, humanId: true, title: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 25,
      }),
    ]);

  const comments = await prisma.comment.findMany({
    where: { deletedAt: null },
    include: {
      author: { select: { id: true, name: true } },
      entry: { select: { id: true, humanId: true, title: true } },
      task: { select: { id: true, humanId: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return {
    incoming,
    openEntries,
    overdueTasks,
    myTasks,
    alerts,
    followUps,
    // Compatibilidad de forma: PMS dejó de alimentar el briefing.
    vipGuests: [] as const,
    reservations: [] as const,
    comments,
  };
}

/**
 * Abre el turno propio de quien entra al mesón.
 *
 * Recepción opera de forma secuencial: el turno saliente debe quedar cerrado
 * antes de que el entrante inicie el suyo. El relevo físico puede ocurrir con
 * ambas personas presentes, pero sólo un turno de Recepción controla la
 * operación en el sistema.
 */
export async function openShift(
  user: CurrentUser,
  input: {
    type?: ShiftType | null;
    date?: Date | null;
    /**
     * Excepción de emergencia. Sólo se usa cuando el relevo quedó bloqueado
     * porque el turno anterior no terminó su cierre y no es viable esperar.
     */
    continuity?: boolean;
    emergencyReason?: ShiftEmergencyReason | null;
    emergencyAccepted?: boolean;
  } = {},
): Promise<{ shift: ShiftWithDetail; joined: boolean }> {
  if (!user.roleOperational || !user.permissions.includes('shift.start')) {
    throw new RuleError(
      'Tu rol no participa en la operación de turnos de Recepción. Usa una cuenta habilitada para el mesón.',
    );
  }

  const mine = await getMyActiveShift(user.id);
  if (mine) return { shift: mine, joined: false };

  const continuityRequested = input.continuity === true;

  const outgoing = await prisma.shift.findFirst({
    where: {
      archivedAt: null,
      status: {
        in: [
          ShiftStatus.INICIADO,
          ShiftStatus.ACTIVO,
          ShiftStatus.PREPARANDO_ENTREGA,
          ShiftStatus.ENTREGA_ENVIADA,
        ],
      },
      assignments: {
        some: {
          activatedAt: { not: null },
          leftAt: null,
        },
      },
    },
    select: { id: true, type: true, status: true },
    orderBy: { actualStart: 'asc' },
  });
  const activeEmergency = continuityRequested
    ? await prisma.shift.findFirst({
        where: {
          emergency: true,
          emergencyResolvedAt: null,
          archivedAt: null,
          status: {
            in: [
              ShiftStatus.INICIADO,
              ShiftStatus.ACTIVO,
              ShiftStatus.PREPARANDO_ENTREGA,
              ShiftStatus.ENTREGA_ENVIADA,
            ],
          },
        },
        select: { id: true },
      })
    : null;
  if (activeEmergency) {
    throw new RuleError(
      'Ya existe un turno de emergencia operativo. No se puede abrir otro: súmate al turno vigente o espera a que la emergencia se libere.',
    );
  }

  const emergencyReasonCode = input.emergencyReason ?? null;
  const emergencyReason =
    emergencyReasonCode && isShiftEmergencyReason(emergencyReasonCode)
      ? SHIFT_EMERGENCY_REASON_LABEL[emergencyReasonCode]
      : null;

  if (outgoing && !continuityRequested) {
    throw new RuleError(
      'El turno saliente todavía no está cerrado. Espera su cierre formal o, sólo si existe una causa válida, usa la apertura de emergencia.',
    );
  }
  if (continuityRequested && !outgoing) {
    throw new RuleError(
      'No existe un turno saliente abierto que justifique una apertura de emergencia. Inicia un turno normal.',
    );
  }
  if (outgoing && continuityRequested) {
    if (!input.emergencyAccepted) {
      throw new RuleError(
        'Debes aceptar expresamente las condiciones antes de abrir un turno de emergencia.',
      );
    }
    if (!emergencyReasonCode || !isShiftEmergencyReason(emergencyReasonCode) || !emergencyReason) {
      throw new RuleError('Selecciona una razón válida para abrir un turno de emergencia.');
    }
  }

  const continuitySnapshot =
    outgoing && continuityRequested
      ? await buildHandoverSnapshot(new Date(), {
          shiftId: outgoing.id,
          includeMetrics: true,
        })
      : null;

  const pendingOperational = await getPendingHandover();
  if (pendingOperational) {
    throw new RuleError(
      'Hay una entrega de turno cerrada pendiente de recepción. Recíbela antes de abrir un turno nuevo.',
    );
  }
  const activateImmediately = true;

  const type = input.type ?? shiftTypeAt();
  const day = input.date
    ? new Date(`${calendarDateKey(input.date)}T00:00:00.000Z`)
    : operationalDate();
  const window = plannedWindow(day, type);

  const created = await prisma
    .$transaction(async (tx) => {
      /*
       * Serializa aperturas de turno en PostgreSQL. El precheck superior da una
       * respuesta rápida, pero dos recepcionistas podrían pulsar «Abrir» en el
       * mismo milisegundo. El advisory lock evita que ambos creen un turno.
       */
      await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_advisory_xact_lock(1279873618) IS NULL AS "locked"
      `;

      let emergencyHandoverId: string | null = null;

      if (continuityRequested) {
        const concurrentEmergency = await tx.shift.findFirst({
          where: {
            emergency: true,
            emergencyResolvedAt: null,
            archivedAt: null,
            status: {
              in: [
                ShiftStatus.INICIADO,
                ShiftStatus.ACTIVO,
                ShiftStatus.PREPARANDO_ENTREGA,
                ShiftStatus.ENTREGA_ENVIADA,
              ],
            },
          },
          select: { id: true },
        });
        if (concurrentEmergency) {
          throw new RuleError(
            'Ya existe un turno de emergencia operativo. No se puede abrir otro hasta que se libere.',
          );
        }
      }

      const concurrentOutgoing = await tx.shift.findFirst({
        where: {
          archivedAt: null,
          status: {
            in: [
              ShiftStatus.INICIADO,
              ShiftStatus.ACTIVO,
              ShiftStatus.PREPARANDO_ENTREGA,
              ShiftStatus.ENTREGA_ENVIADA,
            ],
          },
          assignments: {
            some: {
              activatedAt: { not: null },
              leftAt: null,
              userId: { not: user.id },
            },
          },
        },
        select: {
          id: true,
          type: true,
          date: true,
          status: true,
          startedById: true,
          createdById: true,
          isDemo: true,
          assignments: {
            where: { activatedAt: { not: null }, leftAt: null },
            select: { userId: true },
          },
          handoverOut: {
            select: {
              id: true,
              status: true,
              issuedById: true,
              notes: true,
              snapshot: true,
            },
          },
        },
        orderBy: { actualStart: 'asc' },
      });
      if (concurrentOutgoing && !continuityRequested) {
        throw new RuleError(
          'El turno saliente todavía no está cerrado. Espera su cierre formal o, sólo si existe una causa válida, usa la apertura de emergencia.',
        );
      }

      if (concurrentOutgoing && continuityRequested) {
        const now = new Date();
        const issuerId =
          concurrentOutgoing.handoverOut?.issuedById ??
          concurrentOutgoing.assignments[0]?.userId ??
          concurrentOutgoing.startedById ??
          concurrentOutgoing.createdById ??
          user.id;
        if (!emergencyReason) {
          throw new RuleError('La apertura de emergencia requiere una razón válida.');
        }
        const emergencyNote =
          'EMERGENCIA OPERATIVA: el turno siguiente se inició antes de completar este cierre. ' +
          emergencyReason;

        let handoverId = concurrentOutgoing.handoverOut?.id ?? null;

        if (!concurrentOutgoing.handoverOut) {
          const handover = await tx.shiftHandover.create({
            data: {
              fromShiftId: concurrentOutgoing.id,
              toShiftId: null,
              issuedById: issuerId,
              issuedAt: now,
              status: HandoverStatus.ENVIADA,
              notes: emergencyNote,
              snapshot: {
                generatedAt: now.toISOString(),
                emergency: true,
                contingency: true,
                reason: emergencyReason,
                fromShift: {
                  id: concurrentOutgoing.id,
                  type: concurrentOutgoing.type,
                  date: concurrentOutgoing.date.toISOString(),
                },
                items: (continuitySnapshot ?? []).map((item) => ({
                  level: item.level,
                  section: item.section,
                  title: item.title,
                  detail: item.detail,
                  refType: item.refType,
                  refId: item.refId,
                  manual: false,
                })),
              } satisfies Prisma.InputJsonValue,
              isDemo: concurrentOutgoing.isDemo,
            },
          });
          handoverId = handover.id;

          if ((continuitySnapshot ?? []).length > 0) {
            await tx.handoverItem.createMany({
              data: (continuitySnapshot ?? []).map((item, index) => ({
                handoverId: handover.id,
                level: item.level,
                section: item.section,
                title: item.title,
                detail: item.detail,
                refType: item.refType,
                refId: item.refId,
                manual: false,
                order: SNAPSHOT_SECTION_ORDER.indexOf(item.section) * 1000 + index,
              })),
            });
          }
          await ensureHandoverElements(handover.id, tx);
        } else if (
          concurrentOutgoing.handoverOut.status === HandoverStatus.BORRADOR ||
          concurrentOutgoing.handoverOut.status === HandoverStatus.ANULADA
        ) {
          await tx.shiftHandover.update({
            where: { id: concurrentOutgoing.handoverOut.id },
            data: {
              status: HandoverStatus.ENVIADA,
              issuedAt: now,
              issuedById: issuerId,
              notes: emergencyNote,
              receiverObservations: null,
              receivedById: null,
              receivedAt: null,
              receiverSessionId: null,
              toShiftId: null,
              snapshot: {
                generatedAt: now.toISOString(),
                emergency: true,
                contingency: true,
                reason: emergencyReason,
                fromShift: {
                  id: concurrentOutgoing.id,
                  type: concurrentOutgoing.type,
                  date: concurrentOutgoing.date.toISOString(),
                },
              } satisfies Prisma.InputJsonValue,
            },
          });
        } else {
          const currentSnapshot =
            concurrentOutgoing.handoverOut.snapshot &&
            typeof concurrentOutgoing.handoverOut.snapshot === 'object' &&
            !Array.isArray(concurrentOutgoing.handoverOut.snapshot)
              ? (concurrentOutgoing.handoverOut.snapshot as Prisma.JsonObject)
              : {};
          await tx.shiftHandover.update({
            where: { id: concurrentOutgoing.handoverOut.id },
            data: {
              notes: [concurrentOutgoing.handoverOut.notes, emergencyNote]
                .filter(Boolean)
                .join('\n'),
              snapshot: {
                ...currentSnapshot,
                emergency: true,
                contingency: true,
                reason: emergencyReason,
                emergencyOpenedAt: now.toISOString(),
                emergencyOpenedBy: { id: user.id, name: user.name },
              } satisfies Prisma.InputJsonValue,
            },
          });
        }

        await tx.shift.update({
          where: { id: concurrentOutgoing.id },
          data: { status: ShiftStatus.ENTREGA_ENVIADA },
        });
        await endShiftParticipation(tx, concurrentOutgoing.id, now);

        const alert = await tx.alert.upsert({
          where: { dedupeKey: `shift-emergency-source:${concurrentOutgoing.id}` },
          create: {
            type: AlertType.OTRO,
            level: AlertLevel.CRITICA,
            status: AlertStatus.NUEVA,
            title: 'Turno de emergencia · cierre saliente pendiente',
            message:
              `${user.name} abrió un turno de emergencia mientras el turno anterior seguía sin cierre formal. Motivo: ${emergencyReason}`,
            handoverId,
            dedupeKey: `shift-emergency-source:${concurrentOutgoing.id}`,
            auto: true,
            createdById: user.id,
            isDemo: concurrentOutgoing.isDemo,
          },
          update: {
            status: AlertStatus.NUEVA,
            title: 'Turno de emergencia · cierre saliente pendiente',
            message:
              `${user.name} abrió un turno de emergencia mientras el turno anterior seguía sin cierre formal. Motivo: ${emergencyReason}`,
            auto: true,
            handoverId,
            resolvedAt: null,
            resolvedById: null,
            resolutionNote: null,
            deletedAt: null,
          },
        });

        const supervisors = await tx.user.findMany({
          where: {
            active: true,
            deletedAt: null,
            role: {
              permissions: { some: { permission: { key: 'supervision.view' } } },
            },
          },
          select: { id: true },
        });
        await notify(
          supervisors.map((person) => ({
            userId: person.id,
            type: NotificationType.ACCION_REQUERIDA,
            title: 'Turno de emergencia abierto',
            body: `${user.name} abrió una emergencia. El turno saliente continúa pendiente de cierre formal y requiere seguimiento.`,
            link: handoverId ? `/turno/entrega/${handoverId}` : '/turno',
            entity: 'Alert',
            entityId: alert.id,
            isDemo: concurrentOutgoing.isDemo,
          })),
          tx,
        );

        await notify(
          concurrentOutgoing.assignments
            .filter((assignment) => assignment.userId !== user.id)
            .map((assignment) => ({
              userId: assignment.userId,
              type: NotificationType.ACCION_REQUERIDA,
              title: 'Tu turno quedó pendiente de cierre',
              body: 'Se abrió un turno de emergencia. Completa el cierre de Caja y el cierre formal de tu turno en cuanto sea posible.',
              link: '/turno',
              entity: 'Shift',
              entityId: concurrentOutgoing.id,
              isDemo: concurrentOutgoing.isDemo,
            })),
          tx,
        );

        emergencyHandoverId = handoverId;

        await recordAudit(
          {
            entity: 'Shift',
            entityId: concurrentOutgoing.id,
            action: AuditAction.CAMBIO_ESTADO,
            summary: `Turno de emergencia abierto por ${user.name}; el turno saliente queda pendiente de cierre formal`,
            user,
            before: { status: concurrentOutgoing.status },
            after: {
              status: ShiftStatus.ENTREGA_ENVIADA,
              emergency: true,
              emergencyReason: emergencyReasonCode,
              handoverId,
            },
            reason: emergencyReason,
          },
          tx,
        );
      }

      const concurrentPending = await tx.shiftHandover.findFirst({
        where: {
          status: HandoverStatus.ENVIADA,
          receivedAt: null,
          toShiftId: null,
          fromShift: { status: ShiftStatus.CERRADO },
        },
        select: { id: true },
      });
      if (concurrentPending) {
        throw new RuleError(
          'Hay una entrega de turno cerrada pendiente de recepción. Recíbela antes de abrir un turno nuevo.',
        );
      }

      const now = new Date();
      const programmed = await tx.shift.findFirst({
        where: {
          date: day,
          type,
          status: ShiftStatus.PROGRAMADO,
          archivedAt: null,
          OR: [
            { assignments: { some: { userId: user.id } } },
            { assignments: { none: {} } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });

      const shift = programmed
        ? await tx.shift.update({
            where: { id: programmed.id },
            data: {
              status: ShiftStatus.INICIADO,
              actualStart: now,
              startedById: user.id,
              plannedStart: window.start,
              plannedEnd: window.end,
              emergency: Boolean(concurrentOutgoing && continuityRequested),
              emergencyReason:
                concurrentOutgoing && continuityRequested ? emergencyReason : null,
              emergencySourceShiftId:
                concurrentOutgoing && continuityRequested ? concurrentOutgoing.id : null,
              emergencyAcknowledgedAt:
                concurrentOutgoing && continuityRequested ? now : null,
              emergencyResolvedAt: null,
            },
          })
        : await tx.shift.create({
            data: {
              date: day,
              type,
              status: ShiftStatus.INICIADO,
              plannedStart: window.start,
              plannedEnd: window.end,
              actualStart: now,
              createdById: user.id,
              startedById: user.id,
              emergency: Boolean(concurrentOutgoing && continuityRequested),
              emergencyReason:
                concurrentOutgoing && continuityRequested ? emergencyReason : null,
              emergencySourceShiftId:
                concurrentOutgoing && continuityRequested ? concurrentOutgoing.id : null,
              emergencyAcknowledgedAt:
                concurrentOutgoing && continuityRequested ? now : null,
              emergencyResolvedAt: null,
            },
          });

      const yaAsignados = await tx.shiftAssignment.count({ where: { shiftId: shift.id } });
      await tx.shiftAssignment.upsert({
        where: { shiftId_userId: { shiftId: shift.id, userId: user.id } },
        create: {
          shiftId: shift.id,
          userId: user.id,
          role: yaAsignados === 0 ? AssignmentRole.TITULAR : AssignmentRole.APOYO,
          activatedAt: now,
          leftAt: null,
        },
        update: { activatedAt: now, leftAt: null },
      });

      /*
       * Una emergencia conoce desde su apertura qué entrega la originó. El
       * vínculo se fija ahora para que la regularización posterior reciba sobre
       * ESTE mismo turno y nunca cree ni adivine otro destino.
       *
       * La búsqueda de una entrega RECIBIDA sin destino queda sólo como
       * compatibilidad histórica para versiones anteriores.
       */
      if (emergencyHandoverId) {
        await tx.shiftHandover.updateMany({
          where: {
            id: emergencyHandoverId,
            status: HandoverStatus.ENVIADA,
            toShiftId: null,
          },
          data: { toShiftId: shift.id },
        });
      }

      const receivedLink = emergencyHandoverId
        ? null
        : await tx.shiftHandover.findFirst({
            where: {
              status: HandoverStatus.RECIBIDA,
              receivedAt: { not: null },
              toShiftId: null,
              fromShift: { status: ShiftStatus.CERRADO },
            },
            orderBy: { receivedAt: 'desc' },
            select: { id: true },
          });
      if (receivedLink) {
        await tx.shiftHandover.updateMany({
          where: {
            id: receivedLink.id,
            status: HandoverStatus.RECIBIDA,
            toShiftId: null,
          },
          data: { toShiftId: shift.id },
        });
      }

      await recordAudit(
        {
          entity: 'Shift',
          entityId: shift.id,
          action: AuditAction.TURNO_INICIAR,
          summary:
            (concurrentOutgoing && continuityRequested ? 'EMERGENCIA · ' : '') +
            `Turno de ${SHIFT_TYPE_LABEL[type]} abierto (${SHIFT_WINDOW_LABEL[type]}) ` +
            `el ${formatCalendarDate(day)}`,
          user,
          after: {
            status: ShiftStatus.INICIADO,
            type,
            date: day,
            emergency: Boolean(concurrentOutgoing && continuityRequested),
            emergencyReason: emergencyReasonCode,
            emergencySourceShiftId:
              concurrentOutgoing && continuityRequested ? concurrentOutgoing.id : null,
          },
        },
        tx,
      );

      if (activateImmediately) {
        const active = await tx.shift.update({
          where: { id: shift.id },
          data: { status: ShiftStatus.ACTIVO },
        });
        await recordAudit(
          {
            entity: 'Shift',
            entityId: shift.id,
            action: AuditAction.TURNO_RECIBIR,
            summary: receivedLink
              ? 'Turno activado después de recibir la entrega anterior'
              : 'Turno activado automáticamente: no había entrega pendiente',
            user,
            before: { status: ShiftStatus.INICIADO },
            after: {
              status: ShiftStatus.ACTIVO,
              receivedHandoverId: receivedLink?.id ?? null,
            },
          },
          tx,
        );
        return active;
      }

      return shift;
    })
    .catch((error: unknown) => {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : '';
      const message = error instanceof Error ? error.message : '';
      if (
        code === 'P2002' ||
        message.includes('ShiftAssignment_una_participacion_activa_por_usuario')
      ) {
        throw new RuleError(
          'Ya participas activamente en otro turno. Finaliza esa participación antes de abrir uno nuevo.',
        );
      }
      throw error;
    });

  return { shift: await getShiftById(created.id), joined: false };
}

/**
 * Inicia la recepción de una entrega cerrada.
 *
 * A diferencia del flujo anterior, el turno entrante existe DESDE el primer
 * paso de recepción, pero permanece INICIADO. Esa condición activa la puerta
 * transversal RECEIVING: Novedades, Caja general, Llaves y demás operación
 * siguen bloqueadas hasta confirmar el relevo completo.
 */
export async function startReceptionShift(
  user: CurrentUser,
  input: { handoverId: string; type?: ShiftType | null },
): Promise<ShiftWithDetail> {
  if (!user.roleOperational) {
    throw new RuleError('Tu rol no participa en la recepción operativa de turnos.');
  }

  const handover = await prisma.shiftHandover.findUnique({
    where: { id: input.handoverId },
    include: {
      fromShift: { include: { assignments: { select: { userId: true } } } },
      toShift: {
        include: {
          assignments: {
            where: { userId: user.id, activatedAt: { not: null }, leftAt: null },
            select: { userId: true },
          },
        },
      },
    },
  });
  if (!handover) throw new NotFoundError('La entrega indicada no existe.');
  /*
   * Una persona puede continuar en el turno siguiente aunque haya participado
   * en el saliente. La separación relevante es entre TURNOS: el anterior debe
   * estar formalmente cerrado y su participación terminada antes de crear el
   * nuevo turno receptor. La recepción guiada, el recuento y la auditoría se
   * mantienen completos.
   */
  if (handover.status !== HandoverStatus.ENVIADA || handover.receivedAt) {
    throw new RuleError('Esta entrega ya no está disponible para iniciar una recepción.');
  }
  if (handover.fromShift.status !== ShiftStatus.CERRADO) {
    throw new RuleError('El turno saliente debe quedar cerrado antes de iniciar la recepción normal.');
  }

  if (handover.toShiftId) {
    if (handover.toShift?.assignments.some((assignment) => assignment.userId === user.id)) {
      return getShiftById(handover.toShiftId);
    }
    throw new RuleError('Otra persona ya inició la recepción de esta entrega.');
  }

  const mine = await getMyActiveShift(user.id);
  if (mine) {
    throw new RuleError('Ya participas en un turno. Termina esa participación antes de iniciar otra recepción.');
  }

  const type = input.type ?? shiftTypeAt();
  const day = operationalDate();
  const window = plannedWindow(day, type);

  const shiftId = await prisma
    .$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_advisory_xact_lock(1279873618) IS NULL AS "locked"
      `;

      const fresh = await tx.shiftHandover.findUnique({
        where: { id: handover.id },
        include: {
          fromShift: { include: { assignments: { select: { userId: true } } } },
          toShift: {
            include: {
              assignments: {
                where: { userId: user.id, activatedAt: { not: null }, leftAt: null },
                select: { userId: true },
              },
            },
          },
        },
      });
      if (!fresh) throw new NotFoundError('La entrega indicada ya no existe.');
      if (fresh.toShiftId) {
        if (fresh.toShift?.assignments.some((assignment) => assignment.userId === user.id)) {
          return fresh.toShiftId;
        }
        throw new RuleError('Otra persona ya inició la recepción de esta entrega.');
      }
      if (
        fresh.status !== HandoverStatus.ENVIADA ||
        fresh.receivedAt ||
        fresh.fromShift.status !== ShiftStatus.CERRADO
      ) {
        throw new RuleError('La entrega cambió de estado. Actualiza la pantalla antes de continuar.');
      }

      const occupying = await tx.shift.findFirst({
        where: {
          archivedAt: null,
          status: { in: [ShiftStatus.INICIADO, ShiftStatus.ACTIVO, ShiftStatus.PREPARANDO_ENTREGA] },
          assignments: { some: { activatedAt: { not: null }, leftAt: null } },
        },
        select: { id: true },
      });
      if (occupying) {
        throw new RuleError('Ya existe otro turno operativo en curso. Actualiza la pantalla.');
      }

      const now = new Date();
      const programmed = await tx.shift.findFirst({
        where: {
          date: day,
          type,
          status: ShiftStatus.PROGRAMADO,
          archivedAt: null,
          OR: [
            { assignments: { some: { userId: user.id } } },
            { assignments: { none: {} } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });

      const shift = programmed
        ? await tx.shift.update({
            where: { id: programmed.id },
            data: {
              status: ShiftStatus.INICIADO,
              actualStart: now,
              startedById: user.id,
              plannedStart: window.start,
              plannedEnd: window.end,
              emergency: false,
              emergencyReason: null,
              emergencySourceShiftId: null,
              emergencyAcknowledgedAt: null,
            },
          })
        : await tx.shift.create({
            data: {
              date: day,
              type,
              status: ShiftStatus.INICIADO,
              plannedStart: window.start,
              plannedEnd: window.end,
              actualStart: now,
              createdById: user.id,
              startedById: user.id,
            },
          });

      const existingAssignments = await tx.shiftAssignment.count({ where: { shiftId: shift.id } });
      await tx.shiftAssignment.upsert({
        where: { shiftId_userId: { shiftId: shift.id, userId: user.id } },
        create: {
          shiftId: shift.id,
          userId: user.id,
          role: existingAssignments === 0 ? AssignmentRole.TITULAR : AssignmentRole.APOYO,
          activatedAt: now,
          leftAt: null,
        },
        update: { activatedAt: now, leftAt: null },
      });

      const claimed = await tx.shiftHandover.updateMany({
        where: {
          id: fresh.id,
          status: HandoverStatus.ENVIADA,
          receivedAt: null,
          toShiftId: null,
        },
        data: {
          toShiftId: shift.id,
          receiverBriefingReviewedAt: null,
          receiverCustodyReviewedAt: null,
          receiverFinalReviewAt: null,
          receiverUrgentAcknowledgedAt: null,
        },
      });
      if (claimed.count === 0) {
        throw new RuleError('Otra persona acaba de iniciar esta recepción.');
      }

      await recordAudit(
        {
          entity: 'Shift',
          entityId: shift.id,
          action: AuditAction.TURNO_INICIAR,
          summary: `Recepción de turno iniciada por ${user.name}; operación bloqueada hasta confirmar el relevo`,
          user,
          after: {
            status: ShiftStatus.INICIADO,
            handoverId: fresh.id,
            type,
            date: day,
          },
        },
        tx,
      );

      await recordAudit(
        {
          entity: 'ShiftHandover',
          entityId: fresh.id,
          action: AuditAction.CAMBIO_ESTADO,
          summary: `Entrega tomada para recepción por ${user.name}`,
          user,
          after: { toShiftId: shift.id, receiving: true },
        },
        tx,
      );

      return shift.id;
    })
    .catch((error: unknown) => {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : '';
      if (code === 'P2002') {
        throw new RuleError('Ya participas activamente en otro turno o la recepción fue tomada por otra persona.');
      }
      throw error;
    });

  return getShiftById(shiftId);
}

export type ReceptionReviewStep = 'BRIEFING' | 'CUSTODY' | 'FINAL';

/**
 * Persiste las barreras de la recepción guiada. No basta con navegar entre
 * pantallas: cada avance se vuelve a validar contra el estado real del relevo.
 */
export async function confirmReceptionReviewStep(
  user: CurrentUser,
  params: {
    handoverId: string;
    step: ReceptionReviewStep;
    urgentAcknowledged?: boolean;
  },
) {
  const handover = await prisma.shiftHandover.findUnique({
    where: { id: params.handoverId },
    include: {
      fromShift: true,
      toShift: {
        include: {
          assignments: {
            where: { userId: user.id, activatedAt: { not: null }, leftAt: null },
            select: { userId: true },
          },
        },
      },
      items: { select: { level: true } },
    },
  });
  if (!handover) throw new NotFoundError('La entrega indicada no existe.');
  if (handover.status !== HandoverStatus.ENVIADA || handover.receivedAt) {
    throw new RuleError('Esta entrega ya no está pendiente de recepción.');
  }
  if (handover.fromShift.status !== ShiftStatus.CERRADO) {
    throw new RuleError('El turno saliente todavía no está cerrado formalmente.');
  }
  if (!handover.toShiftId || !handover.toShift) {
    throw new RuleError('Primero inicia la recepción desde Mi turno.');
  }
  if (!handover.toShift.assignments.some((assignment) => assignment.userId === user.id)) {
    throw new RuleError('Esta recepción está siendo realizada por otra persona.');
  }
  if (!(handover.toShift.status === ShiftStatus.INICIADO || handover.toShift.status === ShiftStatus.ACTIVO)) {
    throw new RuleError('El turno receptor ya no admite completar esta recepción.');
  }

  const now = new Date();

  if (params.step === 'BRIEFING') {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.shiftHandover.update({
        where: { id: handover.id },
        data: {
          receiverBriefingReviewedAt: now,
          receiverCustodyReviewedAt: null,
          receiverFinalReviewAt: null,
          receiverUrgentAcknowledgedAt: null,
        },
      });
      await recordAudit(
        {
          entity: 'ShiftHandover',
          entityId: handover.id,
          action: AuditAction.CAMBIO_ESTADO,
          summary: `Entrega revisada por ${user.name} al iniciar la recepción`,
          user,
          after: { receptionStep: 'BRIEFING', reviewedAt: now },
        },
        tx,
      );
      return updated;
    });
  }

  if (!handover.receiverBriefingReviewedAt) {
    throw new RuleError('Primero revisa y confirma la entrega recibida del turno saliente.');
  }

  const cashProblems = await cashBlockersForReceiving(handover.id);
  if (cashProblems.length > 0) throw new RuleError(cashProblems.join(' '));

  const pendingElements = await prisma.handoverElement.findMany({
    where: { handoverId: handover.id, declared: true, confirmed: false },
    include: { elementType: { select: { name: true } } },
  });
  if (params.step === 'CUSTODY' && pendingElements.length > 0) {
    throw new RuleError(
      `Confirma los elementos físicos recibidos antes de continuar: ${pendingElements
        .map((element) => element.elementType.name)
        .join(', ')}.`,
    );
  }

  if (params.step === 'CUSTODY') {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.shiftHandover.update({
        where: { id: handover.id },
        data: {
          receiverCustodyReviewedAt: now,
          receiverFinalReviewAt: null,
          receiverUrgentAcknowledgedAt: null,
        },
      });
      await recordAudit(
        {
          entity: 'ShiftHandover',
          entityId: handover.id,
          action: AuditAction.CAMBIO_ESTADO,
          summary: `Caja, garantías y custodia confirmadas por ${user.name}`,
          user,
          after: { receptionStep: 'CUSTODY', reviewedAt: now },
        },
        tx,
      );
      return updated;
    });
  }

  if (!handover.receiverCustodyReviewedAt) {
    throw new RuleError('Primero completa y confirma la recepción de Caja y custodia.');
  }
  if (pendingElements.length > 0) {
    throw new RuleError('Quedan elementos físicos declarados sin confirmar.');
  }

  const hasUrgent = handover.items.some((item) => item.level === HandoverLevel.URGENTE);
  if (hasUrgent && !params.urgentAcknowledged) {
    throw new RuleError('Hay puntos urgentes. Confirma expresamente que los revisaste.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.shiftHandover.update({
      where: { id: handover.id },
      data: {
        receiverFinalReviewAt: now,
        receiverUrgentAcknowledgedAt: hasUrgent ? now : null,
      },
    });
    await recordAudit(
      {
        entity: 'ShiftHandover',
        entityId: handover.id,
        action: AuditAction.CAMBIO_ESTADO,
        summary: hasUrgent
          ? `Revisión final de recepción confirmada por ${user.name}, con puntos urgentes reconocidos`
          : `Revisión final de recepción confirmada por ${user.name}`,
        user,
        after: {
          receptionStep: 'FINAL',
          reviewedAt: now,
          urgentAcknowledged: hasUrgent,
        },
      },
      tx,
    );
    return updated;
  });
}

/**
 * Suma a alguien a este turno. La persona no puede estar activa en otro.
 */
export async function addShiftMember(
  actor: CurrentUser,
  input: { shiftId: string; userId: string },
): Promise<void> {
  const shift = await getShiftById(input.shiftId);
  if (!OCCUPYING_SHIFT_STATUSES.includes(shift.status)) {
    throw new RuleError('Sólo se puede sumar gente a un turno en curso.');
  }

  const actorIsIn = shift.assignments.some(
    (a) => a.userId === actor.id && a.activatedAt && !a.leftAt,
  );
  const actorSupervises = actor.permissions.includes('shift.manage');
  if (!actorIsIn && !actorSupervises && actor.id !== input.userId) {
    throw new RuleError('Sólo quien está en el turno o quien lo supervisa puede sumar gente.');
  }

  await assertShiftAssignable(input.userId);

  const person = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null, active: true },
    include: { role: { select: { name: true, operational: true } } },
  });
  if (!person) throw new NotFoundError('Esa persona no existe o está inactiva.');
  if (!person.role.operational) {
    throw new RuleError(
      `${person.name} tiene un rol que no participa en la operación de turnos.`,
    );
  }

  if (
    shift.assignments.some(
      (a) => a.userId === input.userId && a.activatedAt && !a.leftAt,
    )
  ) {
    return;
  }

  if (
    actor.id === input.userId &&
    !actorIsIn &&
    !actorSupervises &&
    shift.status !== ShiftStatus.INICIADO &&
    shift.status !== ShiftStatus.ACTIVO
  ) {
    throw new RuleError(
      'No puedes sumarte a un turno que ya está en cierre. Debes incorporarte mientras está iniciado o activo.',
    );
  }

  const role =
    shift.assignments.filter((a) => a.activatedAt && !a.leftAt).length === 0
      ? AssignmentRole.TITULAR
      : AssignmentRole.APOYO;

  await prisma
    .$transaction(async (tx) => {
      const now = new Date();
      await tx.shiftAssignment.upsert({
        where: { shiftId_userId: { shiftId: shift.id, userId: input.userId } },
        create: {
          shiftId: shift.id,
          userId: input.userId,
          role,
          activatedAt: now,
          leftAt: null,
        },
        update: { role, activatedAt: now, leftAt: null },
      });

      await recordAudit(
        {
          entity: 'Shift',
          entityId: shift.id,
          action: AuditAction.EDITAR,
          user: actor,
          summary: `${person.name} se sumó al turno como ${
            role === AssignmentRole.TITULAR ? 'titular' : 'apoyo'
          }`,
        },
        tx,
      );
    })
    .catch((error: unknown) => {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : '';
      if (code === 'P2002') {
        throw new RuleError(
          `${person.name} ya participa activamente en otro turno.`,
        );
      }
      throw error;
    });
}

/**
 * Saca a una persona del turno vigente sin borrar su participación histórica.
 *
 * La asignación se conserva y se marca con leftAt. Si sale quien era TITULAR,
 * se promueve automáticamente a la persona activa más antigua que permanezca.
 * Nunca se permite dejar un turno operativo sin participantes.
 */
export async function removeShiftMember(
  actor: CurrentUser,
  input: { shiftId: string; userId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_advisory_xact_lock(1279873620) IS NULL AS "locked"
    `;

    const shift = await tx.shift.findUnique({
      where: { id: input.shiftId },
      include: {
        assignments: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!shift) throw new NotFoundError('El turno no existe.');
    if (shift.archivedAt) throw new RuleError('Ese turno ya fue archivado.');
    if (shift.status !== ShiftStatus.INICIADO && shift.status !== ShiftStatus.ACTIVO) {
      throw new RuleError(
        'Sólo se puede sacar gente mientras el turno está iniciado o activo. Si el cierre ya comenzó, cancélalo primero.',
      );
    }

    const activeAssignments = shift.assignments.filter(
      (assignment) => assignment.activatedAt && !assignment.leftAt,
    );
    const actorIsIn = activeAssignments.some((assignment) => assignment.userId === actor.id);
    const actorSupervises = actor.permissions.includes('shift.manage');
    if (!actorIsIn && !actorSupervises) {
      throw new RuleError('Sólo quien está en el turno o quien lo supervisa puede sacar gente.');
    }

    const target = activeAssignments.find((assignment) => assignment.userId === input.userId);
    if (!target) {
      throw new RuleError('Esa persona ya no participa activamente en este turno.');
    }
    if (activeAssignments.length <= 1) {
      throw new RuleError(
        'No puedes sacar a la única persona activa del turno. Debes cerrar o reasignar la operación antes.',
      );
    }

    const remaining = activeAssignments.filter((assignment) => assignment.userId !== target.userId);
    const replacement =
      target.role === AssignmentRole.TITULAR
        ? remaining.find((assignment) => assignment.role === AssignmentRole.APOYO) ?? remaining[0]!
        : null;
    const now = new Date();

    await tx.shiftAssignment.update({
      where: { id: target.id },
      data: { leftAt: now },
    });

    if (replacement) {
      await tx.shiftAssignment.update({
        where: { id: replacement.id },
        data: { role: AssignmentRole.TITULAR },
      });
    }

    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.EDITAR,
        user: actor,
        summary:
          actor.id === target.userId
            ? `${target.user.name} salió del turno`
            : `${target.user.name} fue retirado del turno por ${actor.name}`,
        before: {
          removedUserId: target.userId,
          removedUserName: target.user.name,
          removedRole: target.role,
          activeParticipants: activeAssignments.map((assignment) => assignment.userId),
        },
        after: {
          removedUserId: target.userId,
          leftAt: now.toISOString(),
          promotedUserId: replacement?.userId ?? null,
          promotedUserName: replacement?.user.name ?? null,
          activeParticipants: remaining.map((assignment) => assignment.userId),
        },
      },
      tx,
    );
  });
}

/**
 * Corrige el tipo del turno operativo vigente: DÍA ↔ NOCHE.
 *
 * La fecha operativa no cambia. Sí se recalcula la ventana planificada para
 * mantener coherencia con las dos franjas canónicas del hotel.
 */
export async function changeShiftType(
  actor: CurrentUser,
  input: { shiftId: string; type: ShiftType },
): Promise<void> {
  if (!actor.permissions.includes('shift.reassign')) {
    throw new RuleError('Tu rol no puede cambiar el tipo de un turno.');
  }

  await prisma.$transaction(async (tx) => {
    // Evita dos correcciones simultáneas sobre el mismo turno.
    await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_advisory_xact_lock(1279873619) IS NULL AS "locked"
    `;

    const shift = await tx.shift.findUnique({
      where: { id: input.shiftId },
    });
    if (!shift) throw new NotFoundError('El turno no existe.');
    if (shift.archivedAt) throw new RuleError('Ese turno ya fue archivado.');
    if (shift.status !== ShiftStatus.INICIADO && shift.status !== ShiftStatus.ACTIVO) {
      throw new RuleError(
        'El tipo sólo puede cambiarse mientras el turno está iniciado o activo. Si el cierre ya comenzó, cancélalo primero.',
      );
    }
    if (shift.type === input.type) return;

    const window = plannedWindow(shift.date, input.type);

    await tx.shift.update({
      where: { id: shift.id },
      data: {
        type: input.type,
        plannedStart: window.start,
        plannedEnd: window.end,
      },
    });

    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.EDITAR,
        user: actor,
        summary: `Tipo de turno corregido de ${SHIFT_TYPE_LABEL[shift.type]} a ${SHIFT_TYPE_LABEL[input.type]}`,
        before: {
          type: shift.type,
          date: calendarDateKey(shift.date),
          plannedStart: shift.plannedStart.toISOString(),
          plannedEnd: shift.plannedEnd.toISOString(),
        },
        after: {
          type: input.type,
          date: calendarDateKey(shift.date),
          plannedStart: window.start.toISOString(),
          plannedEnd: window.end.toISOString(),
        },
      },
      tx,
    );
  });
}

/**
 * Recuenta la Caja del turno saliente ya enviado/cerrado.
 *
 * Este paso NO activa el turno entrante. La cuenta permanece en RECEIVING hasta
 * que receiveHandover() confirme la entrega operativa completa.
 */
export async function receiveShiftCash(
  user: CurrentUser,
  params: {
    /** Compatibilidad con llamadas antiguas; ya no se usa para reclamar la Caja. */
    shiftId?: string | null;
    handoverId: string;
    quantities: Record<string, number>;
    guaranteeIds?: string[];
    notes?: string | null;
  },
): Promise<{
  statuses: Awaited<ReturnType<typeof confirmHandoverCash>>['statuses'];
  discrepancies: Awaited<ReturnType<typeof confirmHandoverCash>>['discrepancies'];
  shiftId: string;
}> {
  const handover = await prisma.shiftHandover.findUnique({
    where: { id: params.handoverId },
    select: {
      id: true,
      status: true,
      fromShiftId: true,
      toShiftId: true,
      issuedById: true,
      isDemo: true,
      fromShift: { select: { status: true } },
      toShift: {
        select: {
          id: true,
          status: true,
          assignments: {
            where: { userId: user.id, activatedAt: { not: null }, leftAt: null },
            select: { userId: true },
          },
        },
      },
    },
  });
  if (!handover) throw new NotFoundError('La entrega indicada no existe.');
  if (handover.fromShift.status !== ShiftStatus.CERRADO) {
    throw new RuleError(
      'El turno saliente debe estar cerrado formalmente antes de recibir su Caja.',
    );
  }
  if (handover.status !== HandoverStatus.ENVIADA) {
    throw new RuleError(
      'La Caja sólo puede recibirse mientras la entrega cerrada está pendiente de confirmación.',
    );
  }
  if (!handover.toShiftId || !handover.toShift) {
    throw new RuleError('Primero inicia la recepción de turno desde Mi turno.');
  }
  if (!handover.toShift.assignments.some((assignment) => assignment.userId === user.id)) {
    throw new RuleError('Esta recepción está siendo realizada por otra persona.');
  }
  if (!(handover.toShift.status === ShiftStatus.INICIADO || handover.toShift.status === ShiftStatus.ACTIVO)) {
    throw new RuleError('El turno receptor ya no admite este recuento.');
  }

  let statuses: Awaited<ReturnType<typeof confirmHandoverCash>>['statuses'] = [];
  let discrepancies: Awaited<ReturnType<typeof confirmHandoverCash>>['discrepancies'] = [];

  await prisma
    .$transaction(async (tx) => {
      const confirmed = await confirmHandoverCash(tx, user, {
        handoverId: handover.id,
        quantities: params.quantities,
        guaranteeIds: params.guaranteeIds,
        notes: params.notes,
      });
      statuses = confirmed.statuses;
      discrepancies = confirmed.discrepancies;

      if (discrepancies.length > 0) {
        const detail = discrepancies
          .map(
            (row) =>
              `${row.differenceMinor > 0 ? 'sobra ' : 'falta '}${fromMinor(
                Math.abs(row.differenceMinor),
                row.currency,
              )} ${row.currency}`,
          )
          .join('; ');
        const dedupeKey = `cash-difference:${handover.id}`;
        const alert = await tx.alert.upsert({
          where: { dedupeKey },
          create: {
            type: AlertType.OTRO,
            level: AlertLevel.CRITICA,
            status: AlertStatus.NUEVA,
            title: 'Diferencia de caja en el relevo',
            message: `La Caja recibida por ${user.name} no coincide con lo declarado: ${detail}. Revisar el relevo.`,
            handoverId: handover.id,
            dedupeKey,
            auto: false,
            createdById: user.id,
            isDemo: handover.isDemo,
          },
          update: {
            status: AlertStatus.NUEVA,
            message: `La Caja recibida por ${user.name} no coincide con lo declarado: ${detail}. Revisar el relevo.`,
            resolvedAt: null,
            resolvedById: null,
            resolutionNote: null,
            deletedAt: null,
          },
        });

        const supervisors = await tx.user.findMany({
          where: {
            active: true,
            deletedAt: null,
            role: {
              permissions: { some: { permission: { key: 'supervision.view' } } },
            },
          },
          select: { id: true },
        });
        await notify(
          supervisors.map((person) => ({
            userId: person.id,
            type: NotificationType.ACCION_REQUERIDA,
            title: 'Revisar diferencia de Caja',
            body: detail,
            link: `/alertas/sistema?alerta=${alert.id}`,
            entity: 'Alert',
            entityId: alert.id,
            isDemo: handover.isDemo,
          })),
          tx,
        );
      }

      await recordAudit(
        {
          entity: 'ShiftHandover',
          entityId: handover.id,
          action: AuditAction.TURNO_RECIBIR,
          summary:
            `Caja de relevo recibida por ${user.name}` +
            (discrepancies.length ? ' con diferencia' : ' sin diferencias'),
          user,
          after: { cashReceivedAt: new Date() },
        },
        tx,
      );
    })
    .catch((error: unknown) => {
      if (isCashAlreadyReceived(error)) {
        throw new RuleError('Esa Caja ya fue recibida por otra persona.');
      }
      throw error;
    });

  return { statuses, discrepancies, shiftId: handover.toShiftId };
}

/** Activa el turno cuando no existe una Caja previa que recibir. */
export async function activateShift(
  user: CurrentUser,
  params: { shiftId: string },
): Promise<ShiftWithDetail> {
  const shift = await getShiftById(params.shiftId);
  const activeAssignment = shift.assignments.some(
    (a) => a.userId === user.id && a.activatedAt && !a.leftAt,
  );
  if (!activeAssignment) throw new RuleError('No estás participando activamente en este turno.');
  if (shift.status === ShiftStatus.ACTIVO) return shift;
  assertTransition(shift.status, ShiftStatus.ACTIVO);

  if (await isCashEnabled()) {
    const cashPending = await getPendingCashHandover(shift.id);
    if (cashPending) {
      throw new RuleError(
        'Hay una Caja declarada esperando recepción. Recuéntala antes de comenzar la operación.',
      );
    }
  }

  const changed = await prisma.shift.updateMany({
    where: { id: shift.id, status: ShiftStatus.INICIADO },
    data: { status: ShiftStatus.ACTIVO },
  });
  if (changed.count === 0) {
    throw new RuleError('Ese turno acaba de cambiar de estado. Actualiza la pantalla.');
  }

  await recordAudit({
    entity: 'Shift',
    entityId: shift.id,
    action: AuditAction.TURNO_RECIBIR,
    summary: 'Turno activado sin Caja previa que recibir',
    user,
    before: { status: ShiftStatus.INICIADO },
    after: { status: ShiftStatus.ACTIVO },
  });
  return getShiftById(shift.id);
}

/**
 * Recibe la entrega operativa completa. No recibe la Caja y no cierra al saliente.
 */
export async function receiveHandover(
  user: CurrentUser,
  params: {
    /** Compatibilidad de recuperación para turnos INICIADO de versiones anteriores. */
    shiftId?: string | null;
    handoverId?: string | null;
    observations?: string | null;
  },
) {
  if (!params.handoverId) {
    if (!params.shiftId) {
      throw new RuleError('Falta indicar la entrega que se quiere recibir.');
    }
    return activateShift(user, { shiftId: params.shiftId });
  }

  const incoming = await prisma.shiftHandover.findUnique({
    where: { id: params.handoverId },
    include: {
      issuedBy: { select: { id: true, name: true } },
      fromShift: true,
      toShift: {
        select: {
          id: true,
          status: true,
          assignments: {
            where: { userId: user.id, activatedAt: { not: null }, leftAt: null },
            select: { userId: true },
          },
        },
      },
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
    },
  });
  if (!incoming) throw new NotFoundError('La entrega indicada no existe.');
  if (incoming.status === HandoverStatus.RECIBIDA || incoming.receivedAt) {
    throw new RuleError('Esa entrega ya fue recibida y confirmada.');
  }
  if (incoming.status !== HandoverStatus.ENVIADA) {
    throw new RuleError('La entrega operativa todavía no fue enviada.');
  }
  if (incoming.fromShift.status !== ShiftStatus.CERRADO) {
    throw new RuleError(
      'El turno saliente debe quedar cerrado formalmente antes de recibir la entrega.',
    );
  }
  if (!incoming.toShiftId || !incoming.toShift) {
    throw new RuleError('Primero inicia la recepción de turno desde Mi turno.');
  }
  const toShiftId = incoming.toShiftId;
  const toShift = incoming.toShift;
  if (!toShift.assignments.some((assignment) => assignment.userId === user.id)) {
    throw new RuleError('Esta recepción está siendo realizada por otra persona.');
  }
  if (!(toShift.status === ShiftStatus.INICIADO || toShift.status === ShiftStatus.ACTIVO)) {
    throw new RuleError('El turno receptor ya no admite completar esta recepción.');
  }
  if (!incoming.receiverBriefingReviewedAt) {
    throw new RuleError('Primero revisa la entrega del turno saliente.');
  }
  if (!incoming.receiverCustodyReviewedAt) {
    throw new RuleError('Primero completa la recepción de Caja, garantías y custodia.');
  }
  if (!incoming.receiverFinalReviewAt) {
    throw new RuleError('Primero confirma la revisión final de la recepción.');
  }
  const hasUrgentItems = incoming.items.some((item) => item.level === HandoverLevel.URGENTE);
  if (hasUrgentItems && !incoming.receiverUrgentAcknowledgedAt) {
    throw new RuleError('Hay puntos urgentes sin reconocimiento expreso en la recepción.');
  }

  const cashProblems = await cashBlockersForReceiving(incoming.id);
  if (cashProblems.length) throw new RuleError(cashProblems.join(' '));

  const pendingElements = await prisma.handoverElement.findMany({
    where: { handoverId: incoming.id, declared: true, confirmed: false },
    include: { elementType: { select: { name: true } } },
  });
  if (pendingElements.length > 0) {
    throw new RuleError(
      `Quedan elementos físicos sin confirmar: ${pendingElements
        .map((element) => element.elementType.name)
        .join(', ')}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claim = await tx.shiftHandover.updateMany({
      where: {
        id: incoming.id,
        status: HandoverStatus.ENVIADA,
        receivedAt: null,
        toShiftId,
      },
      data: {
        status: HandoverStatus.RECIBIDA,
        receivedById: user.id,
        receivedAt: now,
        receiverSessionId: user.sessionId,
        receiverObservations: params.observations ?? null,
      },
    });
    if (claim.count === 0) {
      throw new RuleError('Esa entrega ya fue recibida por otra persona.');
    }

    /*
     * La recepción final es el único punto que activa un turno normal.
     * Un turno de emergencia ya está ACTIVO y aquí sólo regulariza su relevo
     * histórico, sin crear una segunda sesión operativa.
     */
    if (toShift.status === ShiftStatus.INICIADO) {
      const activated = await tx.shift.updateMany({
        where: { id: toShiftId, status: ShiftStatus.INICIADO },
        data: { status: ShiftStatus.ACTIVO },
      });
      if (activated.count === 0) {
        throw new RuleError('El turno receptor cambió de estado. Actualiza la pantalla.');
      }
      await recordAudit(
        {
          entity: 'Shift',
          entityId: toShiftId,
          action: AuditAction.TURNO_RECIBIR,
          summary: `Turno activado al completar la recepción de ${user.name}`,
          user,
          before: { status: ShiftStatus.INICIADO },
          after: { status: ShiftStatus.ACTIVO, receivedHandoverId: incoming.id },
        },
        tx,
      );
    }

    await tx.alert.updateMany({
      where: { handoverId: incoming.id, auto: true, status: { not: AlertStatus.RESUELTA } },
      data: {
        status: AlertStatus.RESUELTA,
        resolvedAt: now,
        resolvedById: user.id,
        resolutionNote: 'Entrega operativa recibida.',
      },
    });

    await notify(
      {
        userId: incoming.issuedById,
        type: NotificationType.ACCION_REQUERIDA,
        title: 'Tu entrega de turno fue recibida',
        body: `${user.name} confirmó la recepción de la entrega operativa.`,
        link: `/turno/entrega/${incoming.id}`,
        entity: 'ShiftHandover',
        entityId: incoming.id,
      },
      tx,
    );

    await recordAudit(
      {
        entity: 'ShiftHandover',
        entityId: incoming.id,
        action: AuditAction.TURNO_RECIBIR,
        summary: `Entrega operativa recibida por ${user.name}`,
        user,
        before: { status: incoming.status },
        after: {
          status: HandoverStatus.RECIBIDA,
          observations: params.observations ?? null,
          sessionId: user.sessionId,
        },
        reason: params.observations ?? null,
      },
      tx,
    );
  });

  return prisma.shiftHandover.findUniqueOrThrow({
    where: { id: incoming.id },
    include: {
      issuedBy: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
      fromShift: true,
      toShift: true,
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
    },
  });
}

/** Paso 3: abrir la preparación de la entrega, generando el resumen automático. */
export async function prepareHandover(user: CurrentUser, shiftId: string) {
  const shift = await getShiftById(shiftId);
  if (!shift.assignments.some(
    (a) => a.userId === user.id && a.activatedAt && !a.leftAt,
  )) {
    throw new RuleError('Sólo quien está en el turno puede preparar su entrega.');
  }

  if (
    shift.handoverOut &&
    shift.handoverOut.status !== HandoverStatus.BORRADOR &&
    shift.handoverOut.status !== HandoverStatus.ANULADA
  ) {
    throw new RuleError('Este turno ya envió su entrega.');
  }

  if (shift.status !== ShiftStatus.PREPARANDO_ENTREGA) {
    assertTransition(shift.status, ShiftStatus.PREPARANDO_ENTREGA);
  }

  const snapshot = await buildHandoverSnapshot();
  /*
    El destino queda NULO a propósito: cuando alguien entrega, el turno que va
    a recibir todavía no existe —se crea cuando el relevo llega al mesón—. La
    entrega va a la bandeja; la recepción identifica a la persona que la toma
    y el destino `toShiftId` se enlaza recién cuando se abre el turno siguiente.
    Antes se intentaba adivinar ese turno por adyacencia de franjas.
  */

  return prisma.$transaction(async (tx) => {
    const handover = shift.handoverOut
      ? shift.handoverOut.status === HandoverStatus.ANULADA
        ? await tx.shiftHandover.update({
            where: { id: shift.handoverOut.id },
            data: {
              status: HandoverStatus.BORRADOR,
              toShiftId: null,
              issuedById: user.id,
              issuedAt: null,
              receivedById: null,
              receivedAt: null,
              notes: null,
              receiverObservations: null,
              issuerSessionId: null,
              receiverSessionId: null,
              pendingsReviewedAt: null,
              finalReviewAt: null,
              urgentAcknowledgedAt: null,
            },
          })
        : shift.handoverOut
      : await tx.shiftHandover.create({
          data: {
            fromShiftId: shift.id,
            toShiftId: null,
            issuedById: user.id,
            status: HandoverStatus.BORRADOR,
            isDemo: shift.isDemo,
          },
        });

    // Cualquier regeneración cambia el contenido que la persona debe revisar:
    // las confirmaciones anteriores dejan de ser válidas.
    await tx.shiftHandover.update({
      where: { id: handover.id },
      data: {
        pendingsReviewedAt: null,
        finalReviewAt: null,
        urgentAcknowledgedAt: null,
      },
    });

    // El resumen automático se regenera; las notas manuales se conservan.
    await tx.handoverItem.deleteMany({
      where: { handoverId: handover.id, manual: false },
    });
    if (snapshot.length > 0) {
      await tx.handoverItem.createMany({
        data: snapshot.map((item, index) => ({
          handoverId: handover.id,
          level: item.level,
          section: item.section,
          title: item.title,
          detail: item.detail,
          refType: item.refType,
          refId: item.refId,
          manual: false,
          order: SNAPSHOT_SECTION_ORDER.indexOf(item.section) * 1000 + index,
        })),
      });
    }

    /*
      Los elementos físicos que viajan con la caja se materializan acá, al
      preparar. Es idempotente: regenerar el borrador no borra lo que alguien
      ya marcó. Si el hotel no configuró elementos, no crea ninguno.
    */
    await ensureHandoverElements(handover.id, tx);

    if (shift.status !== ShiftStatus.PREPARANDO_ENTREGA) {
      await tx.shift.update({
        where: { id: shift.id },
        data: { status: ShiftStatus.PREPARANDO_ENTREGA },
      });
      await recordAudit(
        {
          entity: 'Shift',
          entityId: shift.id,
          action: AuditAction.CAMBIO_ESTADO,
          summary: 'Turno en preparación de entrega',
          user,
          before: { status: shift.status },
          after: { status: ShiftStatus.PREPARANDO_ENTREGA },
        },
        tx,
      );
    }

    return handover;
  });
}

/**
 * Barreras reales del cierre guiado.
 *
 * A diferencia del parámetro de interfaz `?paso=`, estas confirmaciones se
 * persisten y se vuelven a comprobar en el servidor antes de enviar.
 */
export async function confirmHandoverReviewStep(
  user: CurrentUser,
  params: {
    handoverId: string;
    step: 'PENDINGS' | 'FINAL';
    urgentAcknowledged?: boolean;
  },
) {
  const handover = await prisma.shiftHandover.findUnique({
    where: { id: params.handoverId },
    include: {
      fromShift: { include: { assignments: true } },
      items: { select: { level: true } },
    },
  });
  if (!handover) throw new NotFoundError('La entrega no existe.');
  if (handover.status !== HandoverStatus.BORRADOR) {
    throw new RuleError('La entrega ya no está en preparación.');
  }
  if (!handover.fromShift.assignments.some(
    (assignment) =>
      assignment.userId === user.id && assignment.activatedAt && !assignment.leftAt,
  )) {
    throw new RuleError('Sólo quien está en el turno puede confirmar la revisión de su entrega.');
  }
  if (handover.fromShift.status !== ShiftStatus.PREPARANDO_ENTREGA) {
    throw new RuleError('El turno no está en preparación de entrega.');
  }

  const cashProblems = await cashBlockersForSending(handover.id);
  if (cashProblems.length > 0) throw new RuleError(cashProblems.join(' '));
  if (await isCashEnabled()) await assertShiftCashClosed(handover.fromShiftId);

  const now = new Date();
  const hasUrgent = handover.items.some((item) => item.level === HandoverLevel.URGENTE);

  if (params.step === 'FINAL' && !handover.pendingsReviewedAt) {
    throw new RuleError('Primero confirma que revisaste los pendientes que continuarán al siguiente turno.');
  }
  if (params.step === 'FINAL' && hasUrgent && !params.urgentAcknowledged) {
    throw new RuleError('Hay puntos urgentes. Confirma expresamente que los revisaste antes de continuar.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.shiftHandover.update({
      where: { id: handover.id, status: HandoverStatus.BORRADOR },
      data:
        params.step === 'PENDINGS'
          ? {
              pendingsReviewedAt: now,
              finalReviewAt: null,
              urgentAcknowledgedAt: null,
            }
          : {
              finalReviewAt: now,
              urgentAcknowledgedAt: hasUrgent ? now : null,
            },
    });

    await recordAudit(
      {
        entity: 'ShiftHandover',
        entityId: handover.id,
        action: AuditAction.CAMBIO_ESTADO,
        summary:
          params.step === 'PENDINGS'
            ? 'Pendientes del cierre revisados y confirmados'
            : hasUrgent
              ? 'Revisión final confirmada con reconocimiento de puntos urgentes'
              : 'Revisión final del cierre confirmada',
        user,
        after: {
          reviewStep: params.step,
          pendingsReviewedAt:
            params.step === 'PENDINGS' ? now : handover.pendingsReviewedAt,
          finalReviewAt: params.step === 'FINAL' ? now : null,
          urgentAcknowledgedAt:
            params.step === 'FINAL' && hasUrgent ? now : null,
        },
      },
      tx,
    );
    return row;
  });

  return updated;
}

/** Paso 4: enviar la entrega al turno siguiente. */
export async function sendHandover(
  user: CurrentUser,
  params: { shiftId: string; notes?: string | null },
) {
  const shift = await getShiftById(params.shiftId);
  if (!shift.assignments.some(
    (a) => a.userId === user.id && a.activatedAt && !a.leftAt,
  )) {
    throw new RuleError('Sólo quien está en el turno puede enviar su entrega.');
  }
  const handover = shift.handoverOut;
  if (!handover) {
    throw new RuleError('Primero debes preparar la entrega.');
  }
  if (handover.status !== HandoverStatus.BORRADOR) {
    throw new RuleError('Esta entrega ya fue enviada.');
  }
  assertTransition(shift.status, ShiftStatus.ENTREGA_ENVIADA);

  /*
    La caja se cuenta antes de entregar, no después. Los bloqueos físicos se
    evalúan primero para que el mensaje al usuario apunte a la causa real.
  */
  const cashProblems = await cashBlockersForSending(handover.id);
  if (cashProblems.length > 0) throw new RuleError(cashProblems.join(' '));
  if (await isCashEnabled()) {
    await assertShiftCashClosed(shift.id);
  }

  if (!handover.pendingsReviewedAt) {
    throw new RuleError('Antes de enviar, confirma la revisión de los pendientes del turno.');
  }
  if (!handover.finalReviewAt) {
    throw new RuleError('Antes de enviar, confirma la revisión final de la entrega.');
  }
  const hasUrgentItems = handover.items.some((item) => item.level === HandoverLevel.URGENTE);
  if (hasUrgentItems && !handover.urgentAcknowledgedAt) {
    throw new RuleError('Hay puntos urgentes sin reconocimiento expreso. Vuelve a la revisión final.');
  }

  const items = await prisma.handoverItem.findMany({
    where: { handoverId: handover.id },
    orderBy: [{ level: 'asc' }, { order: 'asc' }],
  });

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const sent = await tx.shiftHandover.update({
      where: { id: handover.id, status: HandoverStatus.BORRADOR },
      data: {
        status: HandoverStatus.ENVIADA,
        issuedAt: now,
        issuedById: user.id,
        issuerSessionId: user.sessionId,
        notes: params.notes ?? handover.notes,
        // El destino sigue nulo al enviar; se enlaza sólo después de recibir.
        // Fotografía inmutable de lo entregado.
        snapshot: {
          generatedAt: now.toISOString(),
          fromShift: {
            id: shift.id,
            type: shift.type,
            date: shift.date.toISOString(),
          },
          issuedBy: { id: user.id, name: user.name },
          counts: {
            urgente: items.filter((i) => i.level === HandoverLevel.URGENTE).length,
            importante: items.filter((i) => i.level === HandoverLevel.IMPORTANTE).length,
            informativo: items.filter((i) => i.level === HandoverLevel.INFORMATIVO).length,
          },
          review: {
            pendingsReviewedAt: handover.pendingsReviewedAt?.toISOString() ?? null,
            finalReviewAt: handover.finalReviewAt?.toISOString() ?? null,
            urgentAcknowledgedAt: handover.urgentAcknowledgedAt?.toISOString() ?? null,
          },
          items: items.map((i) => ({
            level: i.level,
            section: i.section,
            title: i.title,
            detail: i.detail,
            refType: i.refType,
            refId: i.refId,
            manual: i.manual,
          })),
        } satisfies Prisma.InputJsonValue,
      },
    });

    await tx.shift.update({
      where: { id: shift.id, status: ShiftStatus.PREPARANDO_ENTREGA },
      data: { status: ShiftStatus.ENTREGA_ENVIADA },
    });
    // Enviar la entrega NO termina la participación. El recepcionista saliente
    // queda bloqueado en el flujo de cierre hasta cerrar formalmente su turno.
    // La participación se libera únicamente en closeShift().
    
    await recordAudit(
      {
        entity: 'ShiftHandover',
        entityId: sent.id,
        action: AuditAction.TURNO_ENTREGAR,
        summary: `Entrega enviada por ${user.name} (${items.length} puntos)`,
        user,
        after: { status: HandoverStatus.ENVIADA, items: items.length },
      },
      tx,
    );

    /*
      El cierre va a la BANDEJA, no a un turno concreto: cuando se entrega, el
      turno que recibirá no existe todavía. Así que se avisa a quien puede
      recibirlo —los perfiles operativos con `shift.receive`— en lugar de a los
      asignados de un turno siguiente que nadie creó.
    */
    const canReceive = await tx.user.findMany({
      where: {
        deletedAt: null,
        active: true,
        id: { not: user.id },
        role: {
          operational: true,
          permissions: { some: { permission: { key: 'shift.receive' } } },
        },
      },
      select: { id: true },
    });
    await notify(
      canReceive.map((person) => ({
        userId: person.id,
        type: NotificationType.ENTREGA_DISPONIBLE,
        title: 'Hay un cierre de turno esperando',
        body: `${user.name} envió el cierre del turno de ${SHIFT_TYPE_LABEL[shift.type]}. Está en la bandeja para recibirlo.`,
        link: `/turno`,
        entity: 'ShiftHandover',
        entityId: sent.id,
      })),
      tx,
    );

    await queueOperationalMail(tx, {
      eventKey: `handover-sent:${sent.id}`,
      recipients: [SUPERVISION_BACKUP_EMAIL, RECEPTION_BACKUP_EMAIL],
      subject:
        `[Libro Operativo] ENTREGA TURNO ${SHIFT_TYPE_LABEL[shift.type]} · ` +
        `${formatCalendarDate(shift.date)} · ${user.name}`,
      text: [
        'ENTREGA DE TURNO ENVIADA',
        `ID entrega: ${sent.id}`,
        `ID turno: ${shift.id}`,
        `Turno: ${SHIFT_TYPE_LABEL[shift.type]}`,
        `Fecha operativa: ${formatCalendarDate(shift.date)}`,
        `Enviado: ${operationalMailTimestamp(now)}`,
        `Enviado por: ${user.name} (ID ${user.id})`,
        `Caja: cierre formal confirmado antes del envío`,
        `Turno de emergencia: ${shift.emergency ? 'sí' : 'no'}`,
        ...(shift.emergencyReason ? [`Motivo de emergencia: ${shift.emergencyReason}`] : []),
        `Urgentes: ${items.filter((item) => item.level === HandoverLevel.URGENTE).length}`,
        `Importantes: ${items.filter((item) => item.level === HandoverLevel.IMPORTANTE).length}`,
        `Informativos: ${items.filter((item) => item.level === HandoverLevel.INFORMATIVO).length}`,
        `Nota general: ${params.notes ?? handover.notes ?? 'sin nota adicional'}`,
        '',
        'PUNTOS DE ENTREGA',
        ...(items.length === 0
          ? ['Sin puntos pendientes.']
          : items.flatMap((item, index) => [
              `${index + 1}. [${item.level}] ${item.section} · ${item.title}`,
              item.detail ? `   ${item.detail}` : '   Sin detalle adicional.',
              item.refType || item.refId
                ? `   Referencia: ${item.refType ?? '-'} · ${item.refId ?? '-'}`
                : '   Referencia: sin referencia',
            ])),
      ].join('\n'),
    });

    return sent;
  });
}

/**
 * Paso 5: cierre formal del turno saliente.
 *
 * La entrega ya fue enviada y Caja debe estar cerrada. Hasta este punto la
 * participación del saliente sigue activa y la operación general queda
 * bloqueada para esa cuenta. El turno entrante sólo puede iniciarse después.
 * La validación de Supervisión/auditoría es posterior y queda trazada aparte.
 */
export async function closeShift(
  user: CurrentUser,
  params: { shiftId: string; notes?: string | null },
) {
  const shift = await getShiftById(params.shiftId);
  const isOwner = shift.assignments.some(
    (a) => a.userId === user.id && a.activatedAt && !a.leftAt,
  );
  const canManage = user.permissions.includes('shift.manage');
  if (!isOwner && !canManage) {
    throw new RuleError('Sólo quien está en el turno o un supervisor puede cerrarlo.');
  }

  const handoverStatus: 'NONE' | HandoverStatus = shift.handoverOut
    ? shift.handoverOut.status
    : 'NONE';
  assertCanClose({ status: shift.status, handoverStatus });

  // La base de datos conserva el trigger como última barrera, pero el flujo
  // normal debe fallar antes con una regla de negocio legible para Recepción.
  // En una apertura excepcional la entrega pudo quedar ENVIADA antes de que
  // Caja/custodia estuvieran listas, por eso el cierre vuelve a validar las
  // mismas barreras que el envío normal y no confía sólo en el estado ENVIADA.
  if (await isCashEnabled()) {
    if (shift.handoverOut) {
      const closeBlockers = await cashBlockersForSending(shift.handoverOut.id);
      if (closeBlockers.length > 0) {
        throw new RuleError(closeBlockers.join(' '));
      }
    }
    await assertShiftCashClosed(shift.id);
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const claim = await tx.shift.updateMany({
      where: { id: shift.id, status: shift.status },
      data: {
        status: ShiftStatus.CERRADO,
        actualEnd: now,
        closedById: user.id,
        notes: params.notes ?? shift.notes,
      },
    });
    if (claim.count === 0) {
      throw new RuleError('Ese turno acaba de cambiar de estado. Actualiza la pantalla.');
    }

    await endShiftParticipation(tx, shift.id, now);
    await cancelShiftTimers(tx, shift.id, now);

    const emergencySuccessors = await tx.shift.findMany({
      where: {
        emergency: true,
        emergencyResolvedAt: null,
        emergencySourceShiftId: shift.id,
        archivedAt: null,
        status: {
          in: [
            ShiftStatus.INICIADO,
            ShiftStatus.ACTIVO,
            ShiftStatus.PREPARANDO_ENTREGA,
            ShiftStatus.ENTREGA_ENVIADA,
          ],
        },
      },
      select: {
        id: true,
        status: true,
        assignments: {
          where: { activatedAt: { not: null }, leftAt: null },
          select: { userId: true },
        },
      },
    });

    if (emergencySuccessors.length > 0) {
      await tx.shift.updateMany({
        where: { id: { in: emergencySuccessors.map((item) => item.id) } },
        data: {
          emergency: false,
          emergencyResolvedAt: now,
        },
      });

      for (const successor of emergencySuccessors) {
        await recordAudit(
          {
            entity: 'Shift',
            entityId: successor.id,
            action: AuditAction.CAMBIO_ESTADO,
            summary:
              'Condición de emergencia resuelta automáticamente: el turno de origen cerró y el turno vigente continúa como normal',
            user,
            before: { emergency: true, status: successor.status, emergencySourceShiftId: shift.id },
            after: { emergency: false, emergencyResolvedAt: now, status: successor.status },
          },
          tx,
        );

        await notify(
          successor.assignments.map((assignment) => ({
            userId: assignment.userId,
            type: NotificationType.ACCION_REQUERIDA,
            title: 'Emergencia regularizada',
            body: 'El turno que originó la emergencia ya cerró. Tu turno continúa normalmente; completa la recepción pendiente desde Mi turno.',
            link: '/turno',
            entity: 'Shift',
            entityId: successor.id,
          })),
          tx,
        );
      }

      await tx.alert.updateMany({
        where: {
          dedupeKey: `shift-emergency-source:${shift.id}`,
          status: { not: AlertStatus.RESUELTA },
        },
        data: {
          status: AlertStatus.RESUELTA,
          resolvedAt: now,
          resolvedById: user.id,
          resolutionNote:
            'Resuelta automáticamente: el turno de origen cerró y la emergencia quedó liberada.',
        },
      });
    }

    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.TURNO_CERRAR,
        summary: `Turno ${SHIFT_TYPE_LABEL[shift.type]} del ${formatCalendarDate(shift.date)} cerrado por ${user.name}`,
        user,
        before: { status: shift.status },
        after: { status: ShiftStatus.CERRADO },
        reason: params.notes ?? null,
      },
      tx,
    );
    await ensureClosureValidationTask(tx, shift.id, user.id);
    return tx.shift.findUniqueOrThrow({ where: { id: shift.id } });
  });
}

/** Cancela la preparación y devuelve el turno a ACTIVO sin borrar la entrega. */
export async function cancelHandoverPreparation(user: CurrentUser, shiftId: string) {
  const shift = await getShiftById(shiftId);
  if (!shift.assignments.some(
    (a) => a.userId === user.id && a.activatedAt && !a.leftAt,
  )) {
    throw new RuleError('Sólo quien está en el turno puede cancelar la preparación.');
  }
  assertTransition(shift.status, ShiftStatus.ACTIVO);
  if (shift.handoverOut && shift.handoverOut.status !== HandoverStatus.BORRADOR) {
    throw new RuleError('La entrega ya fue enviada: no puede cancelarse.');
  }
  if (shift.handoverOut?.toShiftId) {
    throw new RuleError(
      'La Caja de esta entrega ya fue reclamada por el turno entrante. La preparación ya no puede cancelarse.',
    );
  }
  return prisma.$transaction(async (tx) => {
    if (shift.handoverOut) {
      const handoverId = shift.handoverOut.id;

      /*
       * Cancelar el CIERRE no puede borrar hechos que ya ocurrieron.
       *
       * - HandoverItem, CashCount y HandoverElement son estado de preparación:
       *   se invalidan porque, al volver a operar, deben reconstruirse/recontarse.
       * - CashTransfer NO se borra. Si el efectivo ya salió físicamente a
       *   Tesorería, ese hecho y su CashMovement deben sobrevivir al abandono
       *   del cierre. La siguiente preparación reutiliza el mismo handover y
       *   vuelve a mostrar esas transferencias.
       * - Si Caja ya se había cerrado formalmente, reabrir la operación invalida
       *   ese cierre de Caja. Se marca como reabierto dentro de la misma acción
       *   y queda auditado; no se exige al recepcionista un permiso técnico
       *   adicional para deshacer su propio intento de cierre aún no enviado.
       */
      await tx.handoverItem.deleteMany({ where: { handoverId } });
      await tx.cashCount.deleteMany({ where: { handoverId } });
      await tx.handoverElement.deleteMany({ where: { handoverId } });
      await tx.comment.deleteMany({ where: { handoverId } });
      await tx.task.updateMany({ where: { handoverId }, data: { handoverId: null } });
      await tx.alert.updateMany({ where: { handoverId }, data: { handoverId: null } });

      const reopenedCashRows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "ShiftCashClosure"
        SET "reopenedAt" = NOW(),
            "reopenedById" = ${user.id},
            "reopenReason" = 'Cancelación del cierre de turno antes del envío'
        WHERE "shiftId" = ${shift.id}
          AND "reopenedAt" IS NULL
        RETURNING "id"
      `;
      if (reopenedCashRows.length > 0) {
        await recordAudit(
          {
            entity: 'ShiftCashClosure',
            entityId: shift.id,
            action: AuditAction.REABRIR,
            summary: 'Caja reabierta automáticamente al cancelar el cierre de turno',
            user,
            reason: 'El turno volvió a ACTIVO antes de enviar la entrega.',
          },
          tx,
        );
      }

      await tx.shiftHandover.update({
        where: { id: handoverId },
        data: {
          status: HandoverStatus.ANULADA,
          toShiftId: null,
          issuedAt: null,
          receivedById: null,
          receivedAt: null,
          notes: null,
          receiverObservations: null,
          issuerSessionId: null,
          receiverSessionId: null,
          pendingsReviewedAt: null,
          finalReviewAt: null,
          urgentAcknowledgedAt: null,
        },
      });

      await recordAudit(
        {
          entity: 'ShiftHandover',
          entityId: handoverId,
          action: AuditAction.CAMBIO_ESTADO,
          summary: 'Entrega de turno anulada durante la preparación; los hechos financieros ya registrados se conservaron',
          user,
          before: { status: HandoverStatus.BORRADOR },
          after: { status: HandoverStatus.ANULADA },
        },
        tx,
      );
    }

    const updated = await tx.shift.update({
      where: { id: shift.id },
      data: { status: ShiftStatus.ACTIVO },
    });
    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.CAMBIO_ESTADO,
        summary: 'Preparación de entrega cancelada; el turno volvió a operación activa',
        user,
        before: { status: shift.status },
        after: { status: ShiftStatus.ACTIVO },
      },
      tx,
    );
    return updated;
  });
}
