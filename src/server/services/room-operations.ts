import 'server-only';

import {
  EntryType,
  FineStatus,
  FollowUpStatus,
  GuaranteeState,
  GuaranteeStatus,
  KeyStatus,
  ReservationStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';

export type RoomOperationKind =
  | 'NOVEDAD'
  | 'INCIDENCIA'
  | 'TAREA'
  | 'SEGUIMIENTO'
  | 'GARANTIA'
  | 'MULTA'
  | 'LLAVE'
  | 'PRELLEGADA';

export type RoomOperationMatter = {
  id: string;
  kind: RoomOperationKind;
  humanId: number | null;
  title: string;
  detail: string | null;
  status: string;
  href: string;
  critical: boolean;
  createdAt: Date;
};

export type RoomOperationRow = {
  roomId: string;
  roomNumber: string;
  floor: number | null;
  matters: RoomOperationMatter[];
};

const ACTIVE_GUARANTEE_STATES = [
  GuaranteeState.PENDIENTE,
  GuaranteeState.VIGENTE,
  GuaranteeState.APLICADA_PARCIALMENTE,
] as const;

const ACTIVE_FINE_STATUSES = [
  FineStatus.REGISTRADA,
  FineStatus.NOTIFICADA,
] as const;

const KEY_ATTENTION_STATUSES = [
  KeyStatus.PENDIENTE_DEVOLUCION,
  KeyStatus.EXTRAVIADA,
  KeyStatus.FUERA_DE_SERVICIO,
] as const;

function reservationNeedsAttention(row: {
  requiresAction: boolean;
  guaranteeStatus: GuaranteeStatus;
  balanceDue: { toString(): string } | null;
}) {
  return (
    row.requiresAction ||
    row.guaranteeStatus === GuaranteeStatus.PENDIENTE ||
    row.guaranteeStatus === GuaranteeStatus.RECHAZADA ||
    Number(row.balanceDue ?? 0) > 0
  );
}

export async function getRoomOperationsMonitor(): Promise<RoomOperationRow[]> {
  const rooms = await prisma.room.findMany({
    where: { active: true },
    select: { id: true, number: true, floor: true },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  });

  const roomIds = rooms.map((room) => room.id);
  const roomNumbers = rooms.map((room) => room.number);

  const [entries, tasks, followUps, guarantees, fines, keys, reservations] =
    await Promise.all([
      prisma.operationalEntry.findMany({
        where: {
          deletedAt: null,
          roomId: { in: roomIds },
          type: { in: [EntryType.NOVEDAD, EntryType.INCIDENCIA] },
          status: { in: ENTRY_OPEN_STATUSES },
        },
        select: {
          id: true,
          humanId: true,
          type: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          severity: true,
          occurredAt: true,
          room: { select: { number: true } },
        },
      }),
      prisma.task.findMany({
        where: {
          deletedAt: null,
          roomId: { in: roomIds },
          status: { in: TASK_OPEN_STATUSES },
        },
        select: {
          id: true,
          humanId: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          createdAt: true,
          room: { select: { number: true } },
        },
      }),
      prisma.followUp.findMany({
        where: {
          deletedAt: null,
          status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
          OR: [
            { entry: { roomId: { in: roomIds } } },
            { task: { roomId: { in: roomIds } } },
          ],
        },
        select: {
          id: true,
          humanId: true,
          action: true,
          nextAction: true,
          status: true,
          priority: true,
          createdAt: true,
          entry: { select: { id: true, room: { select: { number: true } } } },
          task: { select: { id: true, room: { select: { number: true } } } },
        },
      }),
      prisma.guarantee.findMany({
        where: {
          deletedAt: null,
          roomNumber: { in: roomNumbers },
          state: { in: [...ACTIVE_GUARANTEE_STATES] },
        },
        select: {
          id: true,
          humanId: true,
          roomNumber: true,
          guestName: true,
          reference: true,
          state: true,
          amount: true,
          currency: true,
          dueAt: true,
          createdAt: true,
        },
      }),
      prisma.fine.findMany({
        where: {
          deletedAt: null,
          roomId: { in: roomIds },
          status: { in: [...ACTIVE_FINE_STATUSES] },
        },
        select: {
          id: true,
          humanId: true,
          reason: true,
          status: true,
          amount: true,
          currency: true,
          createdAt: true,
          room: { select: { number: true } },
        },
      }),
      prisma.roomKey.findMany({
        where: {
          roomId: { in: roomIds },
          status: { in: [...KEY_ATTENTION_STATUSES] },
        },
        select: {
          id: true,
          code: true,
          type: true,
          status: true,
          updatedAt: true,
          room: { select: { number: true } },
        },
      }),
      prisma.reservationReference.findMany({
        where: {
          deletedAt: null,
          roomNumber: { in: roomNumbers },
          status: {
            in: [
              ReservationStatus.PENDIENTE,
              ReservationStatus.CONFIRMADA,
              ReservationStatus.EN_CASA,
            ],
          },
          OR: [
            { requiresAction: true },
            { guaranteeStatus: { in: [GuaranteeStatus.PENDIENTE, GuaranteeStatus.RECHAZADA] } },
            { balanceDue: { gt: 0 } },
          ],
        },
        select: {
          id: true,
          code: true,
          roomNumber: true,
          status: true,
          guaranteeStatus: true,
          balanceDue: true,
          requiresAction: true,
          actionNote: true,
          updatedAt: true,
          guest: { select: { fullName: true } },
        },
      }),
    ]);

  const byRoom = new Map<string, RoomOperationMatter[]>(
    rooms.map((room) => [room.number, []]),
  );

  const add = (roomNumber: string | null | undefined, matter: RoomOperationMatter) => {
    if (!roomNumber) return;
    byRoom.get(roomNumber)?.push(matter);
  };

  for (const row of entries) {
    add(row.room?.number, {
      id: `entry-${row.id}`,
      kind: row.type === EntryType.INCIDENCIA ? 'INCIDENCIA' : 'NOVEDAD',
      humanId: row.humanId,
      title: row.title,
      detail: row.description,
      status: row.status,
      href: `/libro/${row.id}`,
      critical:
        row.priority === 'CRITICA' ||
        row.severity === 'CRITICA',
      createdAt: row.occurredAt,
    });
  }

  for (const row of tasks) {
    add(row.room?.number, {
      id: `task-${row.id}`,
      kind: 'TAREA',
      humanId: row.humanId,
      title: row.title,
      detail: row.description,
      status: row.status,
      href: `/tareas/${row.id}`,
      critical: row.priority === 'CRITICA',
      createdAt: row.createdAt,
    });
  }

  for (const row of followUps) {
    const roomNumber = row.entry?.room?.number ?? row.task?.room?.number;
    const href = row.entry?.id
      ? `/libro/${row.entry.id}`
      : row.task?.id
        ? `/tareas/${row.task.id}`
        : '/seguimientos';
    add(roomNumber, {
      id: `followup-${row.id}`,
      kind: 'SEGUIMIENTO',
      humanId: row.humanId,
      title: row.action,
      detail: row.nextAction,
      status: row.status,
      href,
      critical: row.status === FollowUpStatus.VENCIDO || row.priority === 'CRITICA',
      createdAt: row.createdAt,
    });
  }

  for (const row of guarantees) {
    add(row.roomNumber, {
      id: `guarantee-${row.id}`,
      kind: 'GARANTIA',
      humanId: row.humanId,
      title: row.guestName || row.reference || 'Garantía',
      detail: `${row.currency} ${Number(row.amount).toLocaleString('es-CL')}`,
      status: row.state,
      href: `/caja?seccion=garantias&q=%23${row.humanId}`,
      critical: Boolean(row.dueAt && row.dueAt < new Date()),
      createdAt: row.createdAt,
    });
  }

  for (const row of fines) {
    add(row.room?.number, {
      id: `fine-${row.id}`,
      kind: 'MULTA',
      humanId: row.humanId,
      title: row.reason,
      detail: row.amount ? `${row.currency} ${Number(row.amount).toLocaleString('es-CL')}` : null,
      status: row.status,
      href: `/buscar?q=%23${row.humanId}`,
      critical: false,
      createdAt: row.createdAt,
    });
  }

  for (const row of keys) {
    add(row.room?.number, {
      id: `key-${row.id}`,
      kind: 'LLAVE',
      humanId: null,
      title: `Llave ${row.code}`,
      detail: row.type,
      status: row.status,
      href: `/llaves?piso=${row.room?.number?.slice(0, 1) ?? 'todos'}`,
      critical: row.status === KeyStatus.EXTRAVIADA,
      createdAt: row.updatedAt,
    });
  }

  for (const row of reservations) {
    if (!reservationNeedsAttention(row)) continue;
    const details = [
      row.guest?.fullName,
      row.actionNote,
      row.guaranteeStatus === GuaranteeStatus.PENDIENTE ? 'garantía pendiente' : null,
      row.guaranteeStatus === GuaranteeStatus.RECHAZADA ? 'garantía rechazada' : null,
      Number(row.balanceDue ?? 0) > 0
        ? `saldo pendiente ${Number(row.balanceDue).toLocaleString('es-CL')}`
        : null,
    ].filter(Boolean);
    add(row.roomNumber, {
      id: `reservation-${row.id}`,
      kind: 'PRELLEGADA',
      humanId: null,
      title: `Reserva ${row.code}`,
      detail: details.join(' · ') || null,
      status: row.status,
      href: `/central-reservas?q=${encodeURIComponent(row.code)}`,
      critical:
        row.guaranteeStatus === GuaranteeStatus.RECHAZADA ||
        Number(row.balanceDue ?? 0) > 0,
      createdAt: row.updatedAt,
    });
  }

  return rooms.map((room) => ({
    roomId: room.id,
    roomNumber: room.number,
    floor: room.floor,
    matters: (byRoom.get(room.number) ?? []).sort(
      (a, b) => Number(b.critical) - Number(a.critical) || b.createdAt.getTime() - a.createdAt.getTime(),
    ),
  }));
}
