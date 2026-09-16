import 'server-only';
import {
  AlertStatus,
  AssignmentRole,
  AuditAction,
  HandoverLevel,
  HandoverStatus,
  NotificationType,
  ShiftStatus,
} from '@prisma/client';
// `ShiftType` sólo se usa como tipo: los valores los da `shiftTypeAt`.
import type { Prisma, ShiftType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  FINISHED_SHIFT_STATUSES,
  OCCUPYING_SHIFT_STATUSES,
  SHIFT_TYPE_LABEL,
  SHIFT_WINDOW_LABEL,
  assertCanClose,
  assertTransition,
  plannedWindow,
  shiftTypeAt,
} from '@/domain/shift';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { buildHandoverSnapshot, SNAPSHOT_SECTION_ORDER } from './handover-snapshot';
import { LIVE_ALERT_WHERE } from './alert-engine';
import { getSettingBool } from './settings';
import {
  cashBlockersForReceiving,
  cashBlockersForSending,
  ensureHandoverElements,
} from './cash';

/** Fecha operativa (medianoche local) usada como clave de turno. */
export function operationalDate(now = new Date()): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

export const shiftInclude = {
  assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
  handoverOut: {
    include: {
      issuedBy: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
    },
  },
} satisfies Prisma.ShiftInclude;

export type ShiftWithDetail = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;

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

/**
 * ============================ TURNOS: EL MODELO =============================
 *
 * Tres reglas, y las tres nacen de un atasco real en producción.
 *
 * 1. **Dos ventanas fijas**: día 07:00-19:59 y noche 20:00-07:59. Viven en
 *    `domain/shift.ts`.
 *
 * 2. **Los turnos NO se programan de antemano.** Se crean cuando alguien entra
 *    al mesón. Antes había que programarlos, y de eso venía el atasco: para
 *    recibir una entrega el sistema buscaba «el turno de la franja anterior»
 *    por (fecha, tipo), y si nadie había programado esa franja no encontraba
 *    nada que recibir ni podía cerrar. La adyacencia entre franjas **se
 *    eliminó**: ya no existe `nextShiftSlot` ni `previousShiftSlot`.
 *
 * 3. **Un solo turno en curso a la vez**, para todo el hotel. Si hay uno
 *    abierto, se trabaja sobre ése: quien llega se suma, no abre otro. Lo
 *    garantiza un índice único parcial en la base
 *    (`Shift_un_solo_turno_en_curso`); acá se comprueba además para poder
 *    explicarlo en lenguaje operativo en lugar de mostrar un error de índice.
 *
 * Como consecuencia de (3), **la entrega pendiente es única**: no hay que
 * deducir de qué turno viene, es la que está enviada y sin recibir. Eso es lo
 * que hace que recibir vuelva a funcionar.
 */

/** El turno en curso, si hay alguno. Es único en todo el hotel. */
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
    where: { status: ShiftStatus.ENTREGA_ENVIADA, archivedAt: null },
    include: shiftInclude,
    orderBy: { actualEnd: 'asc' },
  });
}

/**
 * La entrega que está esperando ser recibida.
 *
 * Reemplaza a `getIncomingHandover(shift)`, que deducía el turno anterior por
 * adyacencia de franjas y devolvía `null` en cuanto la cadena tenía un hueco.
 * Ahora no hay nada que deducir: con un solo turno en curso a la vez, la
 * entrega pendiente es simplemente la que está enviada y sin recibir.
 *
 * `exceptShiftId` evita que un turno se reciba a sí mismo.
 */
export async function getPendingHandover(exceptShiftId?: string | null) {
  return prisma.shiftHandover.findFirst({
    where: {
      status: HandoverStatus.ENVIADA,
      receivedAt: null,
      ...(exceptShiftId ? { fromShiftId: { not: exceptShiftId } } : {}),
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
  /** Entrega esperando recepción. */
  pending: Awaited<ReturnType<typeof getPendingHandover>>;
  /** Turnos que entregaron y esperan a alguien. */
  awaitingReceipt: ShiftWithDetail[];
  /** Tipo sugerido para un turno nuevo, según el reloj. */
  suggestedType: ShiftType;
  suggestedWindow: string;
};

export async function getShiftDesk(user: CurrentUser): Promise<ShiftDesk> {
  const [current, awaitingReceipt] = await Promise.all([
    getCurrentShift(),
    getShiftsAwaitingReceipt(),
  ]);
  const pending = await getPendingHandover(current?.id ?? null);
  const suggestedType = shiftTypeAt();

  return {
    current,
    iAmIn: Boolean(current?.assignments.some((a) => a.userId === user.id)),
    pending,
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
  const [incoming, openEntries, overdueTasks, myTasks, alerts, followUps, vipGuests, reservations] =
    await Promise.all([
      getPendingHandover(shift.id),
      prisma.operationalEntry.findMany({
        where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
        include: {
          owner: { select: { id: true, name: true } },
          department: { select: { name: true } },
          guest: { select: { fullName: true, roomNumber: true } },
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
      prisma.guestReference.findMany({
        where: { deletedAt: null, vip: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      prisma.reservationReference.findMany({
        where: {
          deletedAt: null,
          OR: [
            { requiresAction: true },
            { guaranteeStatus: { in: ['PENDIENTE', 'RECHAZADA'] } },
            { balanceDue: { gt: 0 } },
            { status: 'PENDIENTE' },
          ],
        },
        include: { guest: { select: { fullName: true, vip: true } } },
        orderBy: { checkIn: 'asc' },
        take: 20,
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
    vipGuests,
    reservations,
    comments,
  };
}

/**
 * Abre un turno nuevo, o suma a quien llega al que ya está abierto.
 *
 * **Es un solo gesto y a propósito.** Antes había que programar la franja y
 * después tomarla, y esa separación era la fuente del enredo: franjas
 * programadas que nadie tomaba, franjas sin programar que nadie podía tomar.
 * Acá quien entra al mesón dice «entro» y el sistema decide qué significa:
 *
 *   · No hay turno abierto  → se crea uno y esta persona es la titular.
 *   · Ya hay uno abierto    → se suma como apoyo. **Nunca se abre un segundo.**
 *
 * Lo segundo es la regla que pidió el hotel: si hay un turno abierto se trabaja
 * sobre ése. Abrir turnos en paralelo es cómo se pierde la trazabilidad de
 * quién tenía la caja.
 *
 * La carrera entre dos personas pulsando a la vez la resuelve el índice único
 * parcial de la base; acá se traduce a un mensaje que se entiende.
 */
export async function openShift(
  user: CurrentUser,
  input: { type?: ShiftType | null; date?: Date | null } = {},
): Promise<{ shift: ShiftWithDetail; joined: boolean }> {
  if (!user.roleOperational) {
    throw new RuleError(
      'El Administrador de sistema no participa en la operación de turnos. Usa una cuenta operativa.',
    );
  }

  const existing = await getCurrentShift();
  if (existing) {
    // Ya hay turno: se trabaja sobre ése. Sumarse es idempotente.
    if (existing.assignments.some((a) => a.userId === user.id)) {
      return { shift: existing, joined: false };
    }
    await addShiftMember(user, { shiftId: existing.id, userId: user.id });
    return { shift: await getShiftById(existing.id), joined: true };
  }

  const type = input.type ?? shiftTypeAt();
  const day = operationalDate(input.date ?? new Date());
  const window = plannedWindow(day, type);

  const created = await prisma.$transaction(async (tx) => {
    /*
      Si alguien programó esta franja a mano, se reutiliza su fila en lugar de
      crear otra: conserva sus notas y a quien la programó.
    */
    const programmed = await tx.shift.findFirst({
      where: { date: day, type, status: ShiftStatus.PROGRAMADO, archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    const shift = programmed
      ? await tx.shift.update({
          where: { id: programmed.id },
          data: {
            status: ShiftStatus.INICIADO,
            actualStart: new Date(),
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
            actualStart: new Date(),
            createdById: user.id,
            startedById: user.id,
          },
        });

    /*
      Un turno programado a mano PUEDE VENIR YA CON GENTE asignada: el
      supervisor pudo dejar nombres puestos al crearlo. Así que la asignación
      se hace idempotente y el papel se decide por lo que ya hay, en lugar de
      dar por hecho que el turno está vacío. Lo encontraron las pruebas del
      ciclo: `create` reventaba con «Unique constraint failed» al reutilizar
      un turno que ya tenía a esta persona.
    */
    const yaAsignados = await tx.shiftAssignment.count({ where: { shiftId: shift.id } });
    await tx.shiftAssignment.upsert({
      where: { shiftId_userId: { shiftId: shift.id, userId: user.id } },
      create: {
        shiftId: shift.id,
        userId: user.id,
        role: yaAsignados === 0 ? AssignmentRole.TITULAR : AssignmentRole.APOYO,
      },
      update: {},
    });

    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.TURNO_INICIAR,
        summary:
          `Turno de ${SHIFT_TYPE_LABEL[type]} abierto (${SHIFT_WINDOW_LABEL[type]}) ` +
          `el ${day.toLocaleDateString('es-CL')}`,
        user,
        after: { status: ShiftStatus.INICIADO, type, date: day },
      },
      tx,
    );

    return shift;
  }).catch((error: unknown) => {
    /*
      El índice único parcial `Shift_un_solo_turno_en_curso` es quien de verdad
      impide dos turnos a la vez. Si salta, alguien abrió el suyo en el instante
      entre la consulta y la escritura: no es un error del usuario.
    */
    const message = error instanceof Error ? error.message : '';
    if (message.includes('Shift_un_solo_turno_en_curso')) {
      throw new RuleError(
        'Alguien abrió un turno hace un instante. Actualiza la pantalla: se trabaja sobre ese turno.',
      );
    }
    throw error;
  });

  return { shift: await getShiftById(created.id), joined: false };
}

/**
 * Suma a alguien al turno en curso.
 *
 * Lo puede hacer quien está en el turno —el mesón se refuerza solo, sin pedir
 * permiso a nadie— o quien supervisa (`shift.manage`). No se puede sumar a
 * alguien a un turno terminado: eso sería reescribir quién estuvo.
 */
export async function addShiftMember(
  actor: CurrentUser,
  input: { shiftId: string; userId: string },
): Promise<void> {
  const shift = await getShiftById(input.shiftId);

  if (FINISHED_SHIFT_STATUSES.includes(shift.status)) {
    throw new RuleError('Ese turno ya terminó: no se le puede sumar gente.');
  }

  const actorIsIn = shift.assignments.some((a) => a.userId === actor.id);
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

  if (shift.assignments.some((a) => a.userId === input.userId)) return;

  /*
    El primero en entrar es TITULAR; el resto, APOYO. El titular es quien
    responde por la caja, y no puede haber dos.
  */
  const role = shift.assignments.length === 0 ? AssignmentRole.TITULAR : AssignmentRole.APOYO;

  await prisma.shiftAssignment.create({
    data: { shiftId: shift.id, userId: input.userId, role },
  });

  await recordAudit({
    entity: 'Shift',
    entityId: shift.id,
    action: AuditAction.EDITAR,
    user: actor,
    summary: `${person.name} se sumó al turno como ${role === AssignmentRole.TITULAR ? 'titular' : 'apoyo'}`,
  });
}

/**
 * Paso 2: confirmar la recepción de la entrega anterior.
 *
 * Si no hay entrega pendiente (primer turno del ciclo o turno anterior sin
 * entrega), el turno pasa a ACTIVO igualmente, pero el hecho queda auditado.
 */
export async function receiveHandover(
  user: CurrentUser,
  params: { shiftId: string; handoverId?: string | null; observations?: string | null },
) {
  const shift = await getShiftById(params.shiftId);
  if (!shift.assignments.some((a) => a.userId === user.id)) {
    throw new RuleError('No estás asignado a este turno.');
  }

  const incoming = await getPendingHandover(shift.id);

  // La entrega se valida antes que el estado del turno: así el mensaje explica
  // el problema real ("ya fue recibida", "no existe") en lugar de hablar de
  // transiciones de estado.
  if (params.handoverId && (!incoming || incoming.id !== params.handoverId)) {
    const already = await prisma.shiftHandover.findUnique({
      where: { id: params.handoverId },
      select: { id: true, status: true },
    });
    if (!already) throw new NotFoundError('La entrega indicada no existe.');
    if (already.status === HandoverStatus.RECIBIDA) {
      throw new RuleError('Esa entrega ya fue recibida y confirmada.');
    }
    throw new RuleError('La entrega indicada no corresponde a este turno.');
  }

  assertTransition(shift.status, ShiftStatus.ACTIVO);

  /*
    Recibir el turno es recibir la caja. Quien entra recuenta el fondo fijo y
    confirma los elementos ANTES de que la entrega se marque como recibida:
    después ya no hay a quién preguntarle por una diferencia.

    Sólo aplica cuando hay una entrega concreta que recibir. El primer turno
    del ciclo no tiene nada que contar, y si el hotel no configuró fondo fijo
    la lista viene vacía y la recepción funciona como siempre.
  */
  if (incoming) {
    const cashProblems = await cashBlockersForReceiving(incoming.id);
    if (cashProblems.length > 0) throw new RuleError(cashProblems.join(' '));
  }

  const autoClose = await getSettingBool('shift.autoCloseOnReceive', true);

  return prisma.$transaction(async (tx) => {
    const now = new Date();

    if (incoming) {
      // Guarda de concurrencia: sólo una transacción puede pasar de ENVIADA.
      const claim = await tx.shiftHandover.updateMany({
        where: { id: incoming.id, status: HandoverStatus.ENVIADA },
        data: {
          status: HandoverStatus.RECIBIDA,
          receivedById: user.id,
          receivedAt: now,
          receiverSessionId: user.sessionId,
          receiverObservations: params.observations ?? null,
          toShiftId: incoming.toShiftId ?? shift.id,
        },
      });
      if (claim.count === 0) {
        throw new RuleError('Esa entrega ya fue recibida por otro usuario.');
      }

      const fromShift = await tx.shift.findUnique({
        where: { id: incoming.fromShiftId },
        select: { id: true, status: true, type: true, date: true },
      });
      if (fromShift && fromShift.status === ShiftStatus.ENTREGA_ENVIADA) {
        await tx.shift.update({
          where: { id: fromShift.id },
          data: {
            status: autoClose ? ShiftStatus.CERRADO : ShiftStatus.RECIBIDO,
            ...(autoClose ? { actualEnd: fromShift.status ? now : now } : {}),
          },
        });
        await recordAudit(
          {
            entity: 'Shift',
            entityId: fromShift.id,
            action: autoClose ? AuditAction.TURNO_CERRAR : AuditAction.CAMBIO_ESTADO,
            summary: autoClose
              ? 'Turno cerrado automáticamente tras la confirmación de recepción'
              : 'Turno marcado como recibido por el turno siguiente',
            user,
            before: { status: fromShift.status },
            after: { status: autoClose ? ShiftStatus.CERRADO : ShiftStatus.RECIBIDO },
          },
          tx,
        );
      }

      // Las alertas de entrega pendiente dejan de aplicar.
      await tx.alert.updateMany({
        where: { handoverId: incoming.id, auto: true, status: { not: AlertStatus.RESUELTA } },
        data: {
          status: AlertStatus.RESUELTA,
          resolvedAt: now,
          resolvedById: user.id,
          resolutionNote: 'Entrega recibida.',
        },
      });

      await notify(
        {
          userId: incoming.issuedById,
          type: NotificationType.ACCION_REQUERIDA,
          title: 'Tu entrega de turno fue recibida',
          body: `${user.name} confirmó la recepción de la entrega.`,
          link: `/turno/entrega/${incoming.id}`,
          entity: 'ShiftHandover',
          entityId: incoming.id,
        },
        tx,
      );
    }

    const updated = await tx.shift.update({
      where: { id: shift.id, status: ShiftStatus.INICIADO },
      data: { status: ShiftStatus.ACTIVO },
    });

    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.TURNO_RECIBIR,
        summary: incoming
          ? `Recepción de turno confirmada (entrega ${incoming.id})`
          : 'Turno activado sin entrega previa pendiente',
        user,
        before: { status: ShiftStatus.INICIADO },
        after: {
          status: ShiftStatus.ACTIVO,
          handoverId: incoming?.id ?? null,
          observations: params.observations ?? null,
          sessionId: user.sessionId,
        },
        reason: params.observations ?? null,
      },
      tx,
    );

    return updated;
  });
}

/** Paso 3: abrir la preparación de la entrega, generando el resumen automático. */
export async function prepareHandover(user: CurrentUser, shiftId: string) {
  const shift = await getShiftById(shiftId);
  if (!shift.assignments.some((a) => a.userId === user.id)) {
    throw new RuleError('Sólo quien está en el turno puede preparar su entrega.');
  }

  if (shift.handoverOut && shift.handoverOut.status !== HandoverStatus.BORRADOR) {
    throw new RuleError('Este turno ya envió su entrega.');
  }

  if (shift.status !== ShiftStatus.PREPARANDO_ENTREGA) {
    assertTransition(shift.status, ShiftStatus.PREPARANDO_ENTREGA);
  }

  const snapshot = await buildHandoverSnapshot();
  /*
    El destino queda NULO a propósito: cuando alguien entrega, el turno que va
    a recibir todavía no existe —se crea cuando el relevo llega al mesón—. La
    entrega va a la bandeja y `receiveHandover` escribe el destino real. Antes
    se intentaba adivinar el turno siguiente por adyacencia de franjas, y de
    ahí venía que no se pudiera recibir.
  */

  return prisma.$transaction(async (tx) => {
    const handover = shift.handoverOut
      ? await tx.shiftHandover.update({
          where: { id: shift.handoverOut.id },
          data: { toShiftId: null },
        })
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
        // Queda sin destino: lo fija quien la reciba desde la bandeja.
        toShiftId: null,
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

/** Paso 5: cerrar el turno. */
export async function closeShift(
  user: CurrentUser,
  params: { shiftId: string; notes?: string | null },
) {
  const shift = await getShiftById(params.shiftId);
  const isOwner = shift.assignments.some((a) => a.userId === user.id);
  const canManage = user.permissions.includes('shift.manage');
  if (!isOwner && !canManage) {
    throw new RuleError('Sólo quien está en el turno o un supervisor puede cerrarlo.');
  }

  const handoverStatus: 'NONE' | HandoverStatus = shift.handoverOut
    ? shift.handoverOut.status
    : 'NONE';

  // Ya no depende de que exista «el turno siguiente»: depende de la entrega.
  assertCanClose({ status: shift.status, handoverStatus });

  return prisma.$transaction(async (tx) => {
    const closed = await tx.shift.update({
      where: { id: shift.id },
      data: {
        status: ShiftStatus.CERRADO,
        actualEnd: new Date(),
        closedById: user.id,
        notes: params.notes ?? shift.notes,
      },
    });
    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.TURNO_CERRAR,
        summary: `Turno ${SHIFT_TYPE_LABEL[shift.type]} del ${shift.date.toLocaleDateString('es-CL')} cerrado por ${user.name}`,
        user,
        before: { status: shift.status },
        after: { status: ShiftStatus.CERRADO },
        reason: params.notes ?? null,
      },
      tx,
    );
    return closed;
  });
}

/** Cancela la preparación y devuelve el turno a ACTIVO. */
export async function cancelHandoverPreparation(user: CurrentUser, shiftId: string) {
  const shift = await getShiftById(shiftId);
  if (!shift.assignments.some((a) => a.userId === user.id)) {
    throw new RuleError('Sólo quien está en el turno puede cancelar la preparación.');
  }
  assertTransition(shift.status, ShiftStatus.ACTIVO);
  if (shift.handoverOut && shift.handoverOut.status !== HandoverStatus.BORRADOR) {
    throw new RuleError('La entrega ya fue enviada: no puede cancelarse.');
  }
  return prisma.$transaction(async (tx) => {
    if (shift.handoverOut) {
      await tx.handoverItem.deleteMany({ where: { handoverId: shift.handoverOut.id } });
      await tx.shiftHandover.delete({ where: { id: shift.handoverOut.id } });
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
