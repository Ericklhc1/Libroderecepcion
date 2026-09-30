import 'server-only';

import {
  OperationalAlarmStatus,
  FollowUpStatus,
  GuaranteeStatus,
  ReservationStatus,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Vista auxiliar de contexto PMS.
 *
 * No administra reservas ni sustituye FNSRooms u otro PMS. Conserva referencias
 * ya existentes únicamente para enlazarlas con trabajo operativo de AROH.
 */
export async function getReservationCenterSnapshot(now = new Date()) {
  const in72Hours = new Date(now.getTime() + 72 * 60 * 60_000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60_000);

  const reservations = await prisma.reservationReference.findMany({
    where: {
      deletedAt: null,
      OR: [
        {
          checkIn: { gte: now, lte: in72Hours },
          status: { in: [ReservationStatus.PENDIENTE, ReservationStatus.CONFIRMADA] },
        },
        { requiresAction: true },
        { guaranteeStatus: { in: [GuaranteeStatus.PENDIENTE, GuaranteeStatus.RECHAZADA] } },
        { balanceDue: { gt: 0 } },
        { updatedAt: { gte: oneDayAgo } },
      ],
    },
    select: {
      id: true,
      code: true,
      roomNumber: true,
      checkIn: true,
      checkOut: true,
      channel: true,
      status: true,
      guaranteeStatus: true,
      balanceDue: true,
      requiresAction: true,
      actionNote: true,
      notes: true,
      updatedAt: true,
      guest: { select: { fullName: true, vip: true } },
    },
    orderBy: [{ checkIn: 'asc' }, { updatedAt: 'desc' }],
    take: 120,
  });

  const reservationIds = reservations.map((reservation) => reservation.id);
  const [tasks, alerts, followUps] = await Promise.all([
    prisma.task.findMany({
      where: {
        deletedAt: null,
        reservationId: { in: reservationIds },
        status: {
          notIn: [
            TaskStatus.REALIZADA,
            TaskStatus.VALIDADA,
            TaskStatus.COMPLETADA,
            TaskStatus.CANCELADA,
          ],
        },
      },
      select: {
        id: true,
        humanId: true,
        title: true,
        priority: true,
        status: true,
        dueAt: true,
        reservationId: true,
        assignee: { select: { name: true } },
        reservation: { select: { code: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      take: 40,
    }),
    prisma.operationalAlarm.findMany({
      where: {
        status: OperationalAlarmStatus.ACTIVA,
        sourceEntity: 'ReservationReference',
        sourceId: { in: reservationIds },
      },
      select: {
        id: true,
        title: true,
        note: true,
        status: true,
        dueAt: true,
        sourceId: true,
        sourceLink: true,
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      take: 40,
    }),
    reservationIds.length === 0
      ? Promise.resolve([])
      : prisma.followUp.findMany({
          where: {
            deletedAt: null,
            sourceEntity: 'ReservationReference',
            sourceId: { in: reservationIds },
            status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
          },
          select: {
            id: true,
            humanId: true,
            action: true,
            nextAction: true,
            priority: true,
            status: true,
            scheduledAt: true,
            sourceId: true,
            owner: { select: { name: true } },
          },
          orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
          take: 40,
        }),
  ]);

  return {
    now,
    horizons: {
      in24Hours: new Date(now.getTime() + 24 * 60 * 60_000),
      in72Hours,
      oneDayAgo,
    },
    reservations,
    tasks,
    alerts: alerts.map((alert) => ({
      ...alert,
      reservationCode:
        reservations.find((reservation) => reservation.id === alert.sourceId)?.code ?? null,
    })),
    followUps,
  };
}
