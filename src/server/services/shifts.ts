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
import { calendarDateKey, hotelCalendarDate } from '@/domain/time';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  OCCUPYING_SHIFT_STATUSES,
  SHIFT_TYPE_LABEL,
  SHIFT_WINDOW_LABEL,
  assertCanClose,
  assertTransition,
  plannedWindow,
  shiftTypeAt,
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

/** Fecha operativa del hotel, guardada como `@db.Date` estable. */
export function operationalDate(now = new Date()): Date {
  return hotelCalendarDate(now);
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
      assignments: { some: { userId } },
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

/** Turno ya entregado que la persona aún puede cerrar, aunque ya no esté activa en él. */
export async function getMyPendingClosureShift(userId: string) {
  return prisma.shift.findFirst({
    where: {
      status: ShiftStatus.ENTREGA_ENVIADA,
      assignments: { some: { userId } },
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
    where: { status: { in: OCCUPYING_SHIFT_STATUSES } },
    include: shiftInclude,
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
  /** El turno en curso, si hay. */
  current: ShiftWithDetail | null;
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
  const [current, awaitingReceipt] = await Promise.all([
    getMyActiveShift(user.id),
    getShiftsAwaitingReceipt(),
  ]);
  const [pending, cashPending] = await Promise.all([
    getPendingHandover(current?.id ?? null),
    getPendingCashHandover(current?.id ?? null),
  ]);
  const suggestedType = shiftTypeAt();

  return {
    current,
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
          entry: { select: { id: true, seq: true, title: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 25,
      }),
    ]);

  const comments = await prisma.comment.findMany({
    where: { deletedAt: null },
    include: {
      author: { select: { id: true, name: true } },
      entry: { select: { id: true, seq: true, title: true } },
      task: { select: { id: true, seq: true, title: true } },
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
     * Vía de continuidad operativa. Sólo se usa cuando el relevo quedó
     * bloqueado porque el turno anterior no terminó su cierre.
     */
    continuity?: boolean;
    continuityReason?: string | null;
  } = {},
): Promise<{ shift: ShiftWithDetail; joined: boolean }> {
  if (!user.roleOperational) {
    throw new RuleError(
      'El Administrador de sistema no participa en la operación de turnos. Usa una cuenta operativa.',
    );
  }

  const mine = await getMyActiveShift(user.id);
  if (mine) return { shift: mine, joined: false };

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
  const continuityRequested = input.continuity === true;
  const continuityReason =
    input.continuityReason?.trim() ||
    'El turno saliente no completó el cierre y fue necesario mantener la continuidad operativa.';

  if (outgoing && !continuityRequested) {
    throw new RuleError(
      'El turno saliente todavía no está cerrado. Usa «Iniciar turno por contingencia» si necesitas mantener la continuidad operativa.',
    );
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
            },
          },
        },
        orderBy: { actualStart: 'asc' },
      });
      if (concurrentOutgoing && !continuityRequested) {
        throw new RuleError(
          'El turno saliente todavía no está cerrado. Usa «Iniciar turno por contingencia» si necesitas mantener la continuidad operativa.',
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
        const contingencyNote =
          'CONTINUIDAD OPERATIVA: el turno siguiente se inició antes de completar este cierre. ' +
          continuityReason;

        let handoverId = concurrentOutgoing.handoverOut?.id ?? null;

        if (!concurrentOutgoing.handoverOut) {
          const handover = await tx.shiftHandover.create({
            data: {
              fromShiftId: concurrentOutgoing.id,
              toShiftId: null,
              issuedById: issuerId,
              issuedAt: now,
              status: HandoverStatus.ENVIADA,
              notes: contingencyNote,
              snapshot: {
                generatedAt: now.toISOString(),
                contingency: true,
                reason: continuityReason,
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
              notes: contingencyNote,
              receiverObservations: null,
              receivedById: null,
              receivedAt: null,
              receiverSessionId: null,
              toShiftId: null,
              snapshot: {
                generatedAt: now.toISOString(),
                contingency: true,
                reason: continuityReason,
                fromShift: {
                  id: concurrentOutgoing.id,
                  type: concurrentOutgoing.type,
                  date: concurrentOutgoing.date.toISOString(),
                },
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
          where: { dedupeKey: `shift-continuity:${concurrentOutgoing.id}` },
          create: {
            type: AlertType.OTRO,
            level: AlertLevel.CRITICA,
            status: AlertStatus.NUEVA,
            title: 'Cierre de turno incompleto · continuidad operativa',
            message:
              `${user.name} inició el turno siguiente porque el turno anterior no había terminado Caja/entrega/cierre. ${continuityReason}`,
            handoverId,
            dedupeKey: `shift-continuity:${concurrentOutgoing.id}`,
            auto: false,
            createdById: user.id,
            isDemo: concurrentOutgoing.isDemo,
          },
          update: {
            status: AlertStatus.NUEVA,
            message:
              `${user.name} inició el turno siguiente porque el turno anterior no había terminado Caja/entrega/cierre. ${continuityReason}`,
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
            title: 'Revisar cierre incompleto de turno',
            body: `${user.name} mantuvo la continuidad operativa. El turno saliente quedó pendiente de Caja/cierre.`,
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
              body: 'Se inició continuidad operativa. Completa el cierre de Caja y del turno cuando vuelvas al sistema.',
              link: '/turno',
              entity: 'Shift',
              entityId: concurrentOutgoing.id,
              isDemo: concurrentOutgoing.isDemo,
            })),
          tx,
        );

        await recordAudit(
          {
            entity: 'Shift',
            entityId: concurrentOutgoing.id,
            action: AuditAction.CAMBIO_ESTADO,
            summary: `Continuidad operativa iniciada por ${user.name}; el turno saliente queda pendiente de cierre formal`,
            user,
            before: { status: concurrentOutgoing.status },
            after: {
              status: ShiftStatus.ENTREGA_ENVIADA,
              continuity: true,
              handoverId,
            },
            reason: continuityReason,
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
       * La entrega ya fue recibida antes de crear este turno. Recién aquí se
       * enlaza la continuidad: la entrega no estuvo preasignada a una persona
       * ni a un turno inexistente.
       */
      const receivedLink = await tx.shiftHandover.findFirst({
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
            `Turno de ${SHIFT_TYPE_LABEL[type]} abierto (${SHIFT_WINDOW_LABEL[type]}) ` +
            `el ${formatCalendarDate(day)}`,
          user,
          after: { status: ShiftStatus.INICIADO, type, date: day },
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
        update: { activatedAt: now, leftAt: null },
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
    },
  });
  if (!handover) throw new NotFoundError('La entrega indicada no existe.');
  const outgoingMember = await prisma.shiftAssignment.findUnique({
    where: {
      shiftId_userId: {
        shiftId: handover.fromShiftId,
        userId: user.id,
      },
    },
    select: { id: true },
  });
  if (outgoingMember) {
    throw new RuleError('La entrega debe ser recibida por alguien distinto del turno saliente.');
  }
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
            link: '/notificaciones',
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

  return { statuses, discrepancies, shiftId: handover.fromShiftId };
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
      toShift: { select: { id: true, status: true } },
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
    },
  });
  if (!incoming) throw new NotFoundError('La entrega indicada no existe.');
  const outgoingMember = await prisma.shiftAssignment.findUnique({
    where: {
      shiftId_userId: {
        shiftId: incoming.fromShiftId,
        userId: user.id,
      },
    },
    select: { id: true },
  });
  if (outgoingMember) {
    throw new RuleError('La entrega debe ser recibida por alguien distinto del turno saliente.');
  }
  if (incoming.status === HandoverStatus.RECIBIDA || incoming.receivedAt) {
    throw new RuleError('Esa entrega ya fue recibida y confirmada.');
  }
  if (incoming.status !== HandoverStatus.ENVIADA) {
    throw new RuleError('La entrega operativa todavía no fue enviada.');
  }
  if (incoming.fromShift.status !== ShiftStatus.CERRADO) {
    throw new RuleError(
      'El turno saliente debe quedar cerrado formalmente antes de que otra persona reciba la entrega.',
    );
  }

  const cashProblems = await cashBlockersForReceiving(incoming.id);
  if (cashProblems.length) throw new RuleError(cashProblems.join(' '));

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claim = await tx.shiftHandover.updateMany({
      where: {
        id: incoming.id,
        status: HandoverStatus.ENVIADA,
        receivedAt: null,
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
     * Compatibilidad con un relevo que haya quedado a medias antes de esta
     * versión: si ya existía un turno INICIADO enlazado, lo activamos. En el
     * flujo nuevo no existe toShiftId hasta abrir el turno después de recibir.
     */
    if (incoming.toShiftId && incoming.toShift?.status === ShiftStatus.INICIADO) {
      await tx.shift.updateMany({
        where: { id: incoming.toShiftId, status: ShiftStatus.INICIADO },
        data: { status: ShiftStatus.ACTIVO },
      });
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
  if (!shift.assignments.some((a) => a.userId === user.id)) {
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

/** Paso 4: enviar la entrega al turno siguiente. */
export async function sendHandover(
  user: CurrentUser,
  params: { shiftId: string; notes?: string | null },
) {
  const shift = await getShiftById(params.shiftId);
  if (!shift.assignments.some((a) => a.userId === user.id)) {
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
    La caja se cuenta antes de entregar, no después. Si el hotel no tiene
    fondo fijo configurado esto no bloquea nada: la lista viene vacía.
  */
  const cashProblems = await cashBlockersForSending(handover.id);
  if (cashProblems.length > 0) throw new RuleError(cashProblems.join(' '));

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
  const isOwner = shift.assignments.some((a) => a.userId === user.id);
  const canManage = user.permissions.includes('shift.manage');
  if (!isOwner && !canManage) {
    throw new RuleError('Sólo quien estuvo en el turno o un supervisor puede cerrarlo.');
  }

  const handoverStatus: 'NONE' | HandoverStatus = shift.handoverOut
    ? shift.handoverOut.status
    : 'NONE';
  assertCanClose({ status: shift.status, handoverStatus });

  // La base de datos conserva el trigger como última barrera, pero el flujo
  // normal debe fallar antes con una regla de negocio legible para Recepción.
  if (await isCashEnabled()) {
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
  if (!shift.assignments.some((a) => a.userId === user.id)) {
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

      // Antes se borraba el handover y PostgreSQL limpiaba estas relaciones por
      // cascada. Al conservarlo como ANULADA hay que reproducir esa limpieza
      // explícitamente para que una futura preparación parta realmente de cero.
      await tx.handoverItem.deleteMany({ where: { handoverId } });
      await tx.cashCount.deleteMany({ where: { handoverId } });
      await tx.cashTransfer.deleteMany({ where: { handoverId } });
      await tx.handoverElement.deleteMany({ where: { handoverId } });
      await tx.comment.deleteMany({ where: { handoverId } });
      await tx.task.updateMany({ where: { handoverId }, data: { handoverId: null } });
      await tx.alert.updateMany({ where: { handoverId }, data: { handoverId: null } });

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
        },
      });

      await recordAudit(
        {
          entity: 'ShiftHandover',
          entityId: handoverId,
          action: AuditAction.CAMBIO_ESTADO,
          summary: 'Entrega de turno anulada durante la preparación',
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
        summary: 'Preparación de entrega cancelada',
        user,
        before: { status: shift.status },
        after: { status: ShiftStatus.ACTIVO },
      },
      tx,
    );
    return updated;
  });
}
