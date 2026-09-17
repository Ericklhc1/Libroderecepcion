import 'server-only';

import {
  AuditAction,
  EntryStatus,
  EntryType,
  PmsReportKind,
  Priority,
  ReservationStatus,
  RoomStayStage,
  RoomStayStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES } from '@/domain/labels';
import { hotelDateKey, hotelWallDateTime } from '@/domain/time';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';
import {
  assignMainKey,
  markKeysPendingReturn,
  releaseStayKeys,
} from '@/server/services/keys';

function sourceFor(status: RoomStayStatus): PmsReportKind {
  if (status === RoomStayStatus.CHECK_IN) return PmsReportKind.ENTRADAS;
  if (status === RoomStayStatus.CHECK_OUT) return PmsReportKind.SALIDAS;
  return PmsReportKind.IN_HOUSE;
}

function reservationStatusFor(status: RoomStayStatus): ReservationStatus {
  return status === RoomStayStatus.CHECK_IN
    ? ReservationStatus.CONFIRMADA
    : ReservationStatus.EN_CASA;
}

function todayBusinessDate(now = new Date()): Date {
  return hotelWallDateTime(hotelDateKey(now), 12, 0);
}

export async function attachReservationToRoom(
  user: CurrentUser,
  input: {
    roomId: string;
    reservationRefId: string;
    status: RoomStayStatus;
    note?: string | null;
  },
): Promise<{ stayId: string; roomNumber: string; reservationCode: string; guestName: string | null }> {
  const now = new Date();
  const businessDate = todayBusinessDate(now);

  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findFirst({
      where: { id: input.roomId, active: true },
      select: { id: true, number: true },
    });
    const reservation = await tx.reservationReference.findFirst({
      where: { id: input.reservationRefId, deletedAt: null },
      include: { guest: { select: { fullName: true } } },
    });
    if (!room) throw new NotFoundError('La habitación ya no existe o está fuera de servicio.');
    if (!reservation) throw new NotFoundError('La reserva ya no existe.');

    const active = await tx.roomStay.findMany({
      where: {
        roomId: room.id,
        deletedAt: null,
        stage: { in: [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO] },
      },
      select: { id: true, reservationId: true, status: true, guestNames: true },
    });

    if (input.status === RoomStayStatus.IN_HOUSE) {
      const blocker = active.find(
        (stay) =>
          stay.reservationId !== reservation.code &&
          (stay.status === RoomStayStatus.IN_HOUSE || stay.status === RoomStayStatus.CHECK_OUT),
      );
      if (blocker) {
        throw new RuleError(
          'La habitación ' + room.number + ' todavía está ocupada por ' +
          (blocker.guestNames[0] ?? 'otra reserva') + ' (ID ' + blocker.reservationId + ').',
        );
      }
    }

    if (input.status === RoomStayStatus.CHECK_IN) {
      const otherArrival = active.find(
        (stay) => stay.status === RoomStayStatus.CHECK_IN && stay.reservationId !== reservation.code,
      );
      if (otherArrival) {
        throw new RuleError(
          'La habitación ' + room.number + ' ya tiene un check-in pendiente (ID ' +
          otherArrival.reservationId + ').',
        );
      }
    }

    if (input.status === RoomStayStatus.CHECK_OUT) {
      const otherDeparture = active.find(
        (stay) => stay.status === RoomStayStatus.CHECK_OUT && stay.reservationId !== reservation.code,
      );
      if (otherDeparture) {
        throw new RuleError(
          'La habitación ' + room.number + ' ya tiene otro check-out pendiente (ID ' +
          otherDeparture.reservationId + ').',
        );
      }
    }

    const stage =
      input.status === RoomStayStatus.IN_HOUSE
        ? RoomStayStage.CONFIRMADO
        : RoomStayStage.PENDIENTE;

    const exact = await tx.roomStay.findFirst({
      where: {
        businessDate,
        reservationId: reservation.code,
        roomId: room.id,
        status: input.status,
      },
      orderBy: { createdAt: 'asc' },
    });

    const data = {
      reservationRefId: reservation.id,
      guestNames: reservation.guest?.fullName ? [reservation.guest.fullName] : [],
      channel: reservation.channel,
      arrivalDate: reservation.checkIn,
      departureDate: reservation.checkOut,
      pmsStatus: 'Asignación manual desde la ficha de habitación',
      sourceReport: sourceFor(input.status),
      status: input.status,
      stage,
      businessDate,
      touchedManually: true,
      confirmedAt: stage === RoomStayStage.CONFIRMADO ? now : null,
      confirmedById: stage === RoomStayStage.CONFIRMADO ? user.id : null,
      deletedAt: null,
      deletedById: null,
      deletionReason: null,
      note: [
        'Huésped/reserva añadido manualmente a la habitación.',
        input.note?.trim(),
      ].filter(Boolean).join(' '),
    };

    const stay = exact
      ? await tx.roomStay.update({ where: { id: exact.id }, data })
      : await tx.roomStay.create({
          data: {
            reservationId: reservation.code,
            roomId: room.id,
            ...data,
          },
        });

    await tx.reservationReference.update({
      where: { id: reservation.id },
      data: {
        roomNumber: room.number,
        status: reservationStatusFor(input.status),
      },
    });

    let keyCode: string | null = null;
    if (input.status === RoomStayStatus.IN_HOUSE) {
      const held = await tx.roomKey.findFirst({
        where: {
          stayId: stay.id,
          status: { in: ['ASIGNADA', 'COPIA_ADICIONAL', 'PENDIENTE_DEVOLUCION'] },
        },
        select: { code: true },
      });
      if (held) {
        keyCode = held.code;
      } else {
        const key = await assignMainKey(tx, user, { roomId: room.id, stayId: stay.id });
        keyCode = key?.code ?? null;
      }
    }

    await tx.operationalEntry.create({
      data: {
        type: EntryType.NOVEDAD,
        status: EntryStatus.RESUELTO,
        title: 'Asignación manual · hab. ' + room.number + ' · reserva ' + reservation.code,
        description:
          'Se vinculó manualmente la reserva ' + reservation.code +
          (reservation.guest?.fullName ? ' (' + reservation.guest.fullName + ')' : '') +
          ' a la habitación ' + room.number + '. Estado operativo: ' + input.status + '.' +
          (input.note?.trim() ? ' Observación: ' + input.note.trim() : ''),
        category: 'ASIGNACION_MANUAL_ESTADIA',
        roomId: room.id,
        reservationId: reservation.id,
        guestId: reservation.guestId,
        priority: Priority.BAJA,
        occurredAt: now,
        ownerId: user.id,
        createdById: user.id,
        requiresFollowUp: false,
        resolution: 'Asignación manual aplicada.',
        tags: ['informacion', 'asignacion-manual', 'reserva-' + reservation.code],
      },
    });

    await recordAudit(
      {
        entity: 'RoomStay',
        entityId: stay.id,
        action: exact ? AuditAction.EDITAR : AuditAction.CREAR,
        user,
        summary:
          'Reserva ' + reservation.code + ' vinculada manualmente a habitación ' +
          room.number + ' como ' + input.status + (keyCode ? ' · llave ' + keyCode : ''),
        after: {
          reservationId: reservation.code,
          roomNumber: room.number,
          status: input.status,
          stage,
          keyCode,
        },
        reason: input.note?.trim() || null,
      },
      tx,
    );

    return {
      stayId: stay.id,
      roomNumber: room.number,
      reservationCode: reservation.code,
      guestName: reservation.guest?.fullName ?? null,
    };
  });
}

export async function moveStayToRoom(
  user: CurrentUser,
  input: { stayId: string; targetRoomId: string; note?: string | null },
): Promise<{
  sourceRoom: string;
  targetRoom: string;
  reservationCode: string;
  newStayId: string;
  movedOpenEntries: number;
  keyCode: string | null;
}> {
  const now = new Date();
  const businessDate = todayBusinessDate(now);

  return prisma.$transaction(async (tx) => {
    const stay = await tx.roomStay.findFirst({
      where: { id: input.stayId, deletedAt: null },
      include: {
        room: { select: { id: true, number: true } },
        reservationRef: {
          include: { guest: { select: { fullName: true } } },
        },
      },
    });
    if (!stay) throw new NotFoundError('La estadía ya no existe.');
    if (!stay.room) throw new RuleError('La estadía no tiene habitación de origen.');
    if (stay.stage === RoomStayStage.FINALIZADO) {
      throw new RuleError('Una estadía ya finalizada no se mueve; corrige su historial desde administración.');
    }

    const target = await tx.room.findFirst({
      where: { id: input.targetRoomId, active: true },
      select: { id: true, number: true },
    });
    if (!target) throw new NotFoundError('La habitación de destino no existe o está fuera de servicio.');
    if (target.id === stay.room.id) throw new RuleError('La habitación de destino es la misma habitación actual.');

    const reusable = await tx.roomStay.findFirst({
      where: {
        businessDate,
        reservationId: stay.reservationId,
        roomId: target.id,
        status: stay.status,
      },
      orderBy: { createdAt: 'asc' },
    });

    const blockers = await tx.roomStay.findMany({
      where: {
        roomId: target.id,
        deletedAt: null,
        stage: { in: [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO] },
        ...(reusable ? { id: { not: reusable.id } } : {}),
      },
      select: { id: true, reservationId: true, status: true, guestNames: true },
    });
    if (blockers.length > 0) {
      const blocker = blockers[0]!;
      throw new RuleError(
        'La habitación ' + target.number + ' ya tiene una estadía activa: ' +
        (blocker.guestNames[0] ?? 'sin nombre') + ' · ID ' + blocker.reservationId +
        ' · ' + blocker.status + '.',
      );
    }

    const originalDeparture = stay.departureDate;
    const sourceRoom = stay.room;

    await releaseStayKeys(
      tx,
      user,
      stay.id,
      'Room move ' + sourceRoom.number + ' → ' + target.number,
    );

    await tx.roomStay.update({
      where: { id: stay.id },
      data: {
        stage: RoomStayStage.FINALIZADO,
        departureDate: businessDate,
        confirmedAt: now,
        confirmedById: user.id,
        touchedManually: true,
        note: [
          stay.note,
          'ROOM MOVE ' + sourceRoom.number + ' → ' + target.number + '.',
          originalDeparture ? 'Salida prevista original: ' + originalDeparture.toISOString() + '.' : null,
          input.note?.trim(),
        ].filter(Boolean).join(' '),
      },
    });

    const targetData = {
      reservationRefId: stay.reservationRefId,
      guestNames: stay.guestNames,
      channel: stay.channel,
      arrivalDate: businessDate,
      departureDate: originalDeparture,
      pmsStatus: stay.pmsStatus,
      sourceReport: stay.sourceReport,
      status: stay.status,
      guestCount: stay.guestCount,
      totalAmount: stay.totalAmount,
      pendingAmount: stay.pendingAmount,
      currency: stay.currency,
      paymentType: stay.paymentType,
      paymentTypeRaw: stay.paymentTypeRaw,
      stage: stay.stage,
      batchId: null,
      confirmedAt: stay.stage === RoomStayStage.CONFIRMADO ? now : null,
      confirmedById: stay.stage === RoomStayStage.CONFIRMADO ? user.id : null,
      touchedManually: true,
      deletedAt: null,
      deletedById: null,
      deletionReason: null,
      note: [
        'ROOM MOVE desde habitación ' + sourceRoom.number + '.',
        input.note?.trim(),
      ].filter(Boolean).join(' '),
    };

    const newStay = reusable
      ? await tx.roomStay.update({ where: { id: reusable.id }, data: targetData })
      : await tx.roomStay.create({
          data: {
            reservationId: stay.reservationId,
            roomId: target.id,
            businessDate,
            ...targetData,
          },
        });

    if (stay.reservationRefId) {
      await tx.reservationReference.update({
        where: { id: stay.reservationRefId },
        data: {
          roomNumber: target.number,
          status: reservationStatusFor(stay.status),
        },
      });
    }

    let movedOpenEntries = 0;
    if (stay.reservationRefId) {
      const moved = await tx.operationalEntry.updateMany({
        where: {
          roomId: sourceRoom.id,
          reservationId: stay.reservationRefId,
          deletedAt: null,
          status: { in: ENTRY_OPEN_STATUSES },
        },
        data: { roomId: target.id },
      });
      movedOpenEntries = moved.count;
    }

    const guestId = stay.reservationRef?.guestId ?? null;
    const guestName =
      stay.reservationRef?.guest?.fullName ?? stay.guestNames[0] ?? 'Huésped';

    await tx.operationalEntry.createMany({
      data: [
        {
          type: EntryType.NOVEDAD,
          status: EntryStatus.RESUELTO,
          title: 'Room move · salida hab. ' + sourceRoom.number + ' → ' + target.number,
          description:
            guestName + ' · reserva ' + stay.reservationId + '. ' +
            'La ocupación de la habitación ' + sourceRoom.number +
            ' queda cerrada por cambio de habitación. El historial anterior permanece asociado a esta habitación. ' +
            'Nuevo destino: ' + target.number + '.' +
            (input.note?.trim() ? ' Observación: ' + input.note.trim() : ''),
          category: 'CAMBIO_HABITACION',
          roomId: sourceRoom.id,
          reservationId: stay.reservationRefId,
          guestId,
          priority: Priority.BAJA,
          occurredAt: now,
          ownerId: user.id,
          createdById: user.id,
          requiresFollowUp: false,
          resolution: 'Trasladado a habitación ' + target.number + '.',
          tags: ['informacion', 'room-move', 'origen', 'reserva-' + stay.reservationId],
        },
        {
          type: EntryType.NOVEDAD,
          status: EntryStatus.RESUELTO,
          title: 'Room move · ingreso hab. ' + target.number + ' desde ' + sourceRoom.number,
          description:
            guestName + ' · reserva ' + stay.reservationId + '. ' +
            'Nueva ocupación en habitación ' + target.number +
            '; conserva reserva, garantía, pendientes e historial de la estadía. Origen: ' +
            sourceRoom.number + '.' +
            (input.note?.trim() ? ' Observación: ' + input.note.trim() : ''),
          category: 'CAMBIO_HABITACION',
          roomId: target.id,
          reservationId: stay.reservationRefId,
          guestId,
          priority: Priority.BAJA,
          occurredAt: now,
          ownerId: user.id,
          createdById: user.id,
          requiresFollowUp: false,
          resolution: 'Traslado desde habitación ' + sourceRoom.number + '.',
          tags: ['informacion', 'room-move', 'destino', 'reserva-' + stay.reservationId],
        },
      ],
    });

    let keyCode: string | null = null;
    if (stay.status === RoomStayStatus.IN_HOUSE || stay.status === RoomStayStatus.CHECK_OUT) {
      const key = await assignMainKey(tx, user, { roomId: target.id, stayId: newStay.id });
      keyCode = key?.code ?? null;
      if (stay.status === RoomStayStatus.CHECK_OUT && key) {
        await markKeysPendingReturn(tx, user, newStay.id);
      }
    }

    await recordAudit(
      {
        entity: 'RoomStay',
        entityId: stay.id,
        action: AuditAction.EDITAR,
        user,
        summary:
          'Room move reserva ' + stay.reservationId + ': ' + sourceRoom.number +
          ' → ' + target.number,
        before: {
          roomNumber: sourceRoom.number,
          status: stay.status,
          stage: stay.stage,
          arrivalDate: stay.arrivalDate,
          departureDate: originalDeparture,
        },
        after: {
          roomNumber: target.number,
          status: stay.status,
          stage: stay.stage,
          newStayId: newStay.id,
          movedOpenEntries,
          keyCode,
        },
        reason: input.note?.trim() || null,
      },
      tx,
    );

    return {
      sourceRoom: sourceRoom.number,
      targetRoom: target.number,
      reservationCode: stay.reservationId,
      newStayId: newStay.id,
      movedOpenEntries,
      keyCode,
    };
  });
}
