import 'server-only';

import {
  FollowUpStatus,
  OperationalAlarmStatus,
  GuaranteeStatus,
  ReservationStatus,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Bandeja de Prellegadas.
 *
 * No replica el PMS: reúne referencias ya presentes en AROH y sus excepciones
 * para preparar próximas llegadas. Las Alertas son OperationalAlarm; la tabla
 * Alert legada no participa en esta pantalla.
 */
export async function getReservationCenterSnapshot(user: CurrentUser, now = new Date()) {
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
        sourceEntity: 'ReservationReference',
        sourceId: { in: reservationIds },
        status: OperationalAlarmStatus.ACTIVA,
        ...(
          user.isSystemAdmin ||
          user.permissions.includes('shift.manage') ||
          user.permissions.includes('supervision.center.view') ||
          user.permissions.includes('management.dashboard.view')
            ? {}
            : {
                OR: [
                  { createdById: user.id },
                  { recipients: { some: { userId: user.id } } },
                ],
              }
        ),
      },
      select: {
        id: true,
        title: true,
        note: true,
        kind: true,
        status: true,
        dueAt: true,
        sourceId: true,
        createdAt: true,
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

  const reservationCodeById = new Map(
    reservations.map((reservation) => [reservation.id, reservation.code]),
  );

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
      reservation: alert.sourceId
        ? { code: reservationCodeById.get(alert.sourceId) ?? 'Reserva' }
        : null,
    })),
    followUps,
  };
}
