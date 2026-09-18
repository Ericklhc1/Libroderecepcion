import 'server-only';

import { AlertStatus, AuditAction, RoomStayStage } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { recordAudit } from '@/server/audit';
import { linkStaysToReservations } from '@/server/services/pms-import';
import { getSettingBool } from '@/server/services/settings';

type DuplicateAlertGroup = {
  signature: string;
  ids: string[];
  title: string;
  status: string[];
  safeToRepair: boolean;
};

type StayConflict = {
  reservationId: string;
  roomNumber: string | null;
  status: string;
  stayIds: string[];
};

export type DiagnosticReport = {
  duplicateAlerts: DuplicateAlertGroup[];
  unlinkedStayCount: number;
  reservationRoomMismatches: Array<{
    reservationRefId: string;
    fnsId: string;
    currentRoomNumber: string | null;
    expectedRoomNumber: string | null;
    activeRooms: string[];
  }>;
  duplicateActiveStays: StayConflict[];
  runtimeErrors: Array<{
    id: string;
    summary: string;
    createdAt: Date;
    userName: string | null;
    after: unknown;
  }>;
};

function alertSignature(alert: {
  type: string;
  title: string;
  message: string | null;
  entryId: string | null;
  taskId: string | null;
  followUpId: string | null;
  handoverId: string | null;
  guestId: string | null;
  reservationId: string | null;
  guaranteeId: string | null;
}): string {
  return JSON.stringify([
    alert.type,
    alert.title.trim().toLowerCase(),
    alert.message?.trim().toLowerCase() ?? '',
    alert.entryId,
    alert.taskId,
    alert.followUpId,
    alert.handoverId,
    alert.guestId,
    alert.reservationId,
    alert.guaranteeId,
  ]);
}

export async function getDiagnosticReport(): Promise<DiagnosticReport> {
  const [alerts, unlinkedStays, reservations, activeStays, runtimeErrors] = await Promise.all([
    prisma.alert.findMany({
      where: {
        deletedAt: null,
        status: { not: AlertStatus.RESUELTA },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        status: true,
        entryId: true,
        taskId: true,
        followUpId: true,
        handoverId: true,
        guestId: true,
        reservationId: true,
        guaranteeId: true,
        _count: { select: { comments: true, tasks: true } },
      },
    }),
    prisma.roomStay.findMany({
      where: {
        deletedAt: null,
        reservationRefId: null,
      },
      select: { id: true, reservationId: true },
    }),
    prisma.reservationReference.findMany({
      where: {
        deletedAt: null,
        stays: {
          some: {
            deletedAt: null,
            stage: { in: [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO] },
            roomId: { not: null },
          },
        },
      },
      select: {
        id: true,
        code: true,
        roomNumber: true,
        stays: {
          where: {
            deletedAt: null,
            stage: { in: [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO] },
          },
          select: { room: { select: { number: true } } },
        },
      },
    }),
    prisma.roomStay.findMany({
      where: {
        deletedAt: null,
        stage: { in: [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO] },
      },
      select: {
        id: true,
        reservationId: true,
        status: true,
        room: { select: { number: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { entity: 'RuntimeError' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        summary: true,
        createdAt: true,
        after: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  const alertGroups = new Map<string, typeof alerts>();
  for (const alert of alerts) {
    const signature = alertSignature(alert);
    const list = alertGroups.get(signature) ?? [];
    list.push(alert);
    alertGroups.set(signature, list);
  }

  const duplicateAlerts = [...alertGroups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([signature, rows]) => ({
      signature,
      ids: rows.map((row) => row.id),
      title: rows[0]?.title ?? 'Alerta duplicada',
      status: rows.map((row) => row.status),
      safeToRepair: rows.slice(1).every((row) => row._count.comments === 0 && row._count.tasks === 0),
    }));

  const knownReservationCodes = new Set(
    (
      await prisma.reservationReference.findMany({
        where: {
          deletedAt: null,
          code: { in: [...new Set(unlinkedStays.map((stay) => stay.reservationId))] },
        },
        select: { code: true },
      })
    ).map((reservation) => reservation.code),
  );
  const unlinkedStayCount = unlinkedStays.filter((stay) =>
    knownReservationCodes.has(stay.reservationId),
  ).length;

  const reservationRoomMismatches = reservations.flatMap((reservation) => {
    const activeRooms = [
      ...new Set(
        reservation.stays
          .map((stay) => stay.room?.number)
          .filter((room): room is string => Boolean(room)),
      ),
    ];
    if (activeRooms.length === 0) return [];
    const expectedRoomNumber = activeRooms.length === 1 ? activeRooms[0]! : null;
    if (reservation.roomNumber === expectedRoomNumber) return [];
    return [{
      reservationRefId: reservation.id,
      fnsId: reservation.code,
      currentRoomNumber: reservation.roomNumber,
      expectedRoomNumber,
      activeRooms,
    }];
  });

  const activeStayGroups = new Map<string, typeof activeStays>();
  for (const stay of activeStays) {
    const key = JSON.stringify([stay.reservationId, stay.room?.number ?? null, stay.status]);
    const list = activeStayGroups.get(key) ?? [];
    list.push(stay);
    activeStayGroups.set(key, list);
  }
  const duplicateActiveStays = [...activeStayGroups.values()]
    .filter((rows) => rows.length > 1)
    .map((rows) => ({
      reservationId: rows[0]!.reservationId,
      roomNumber: rows[0]!.room?.number ?? null,
      status: rows[0]!.status,
      stayIds: rows.map((row) => row.id),
    }));

  return {
    duplicateAlerts,
    unlinkedStayCount,
    reservationRoomMismatches,
    duplicateActiveStays,
    runtimeErrors: runtimeErrors.map((row) => ({
      id: row.id,
      summary: row.summary,
      createdAt: row.createdAt,
      userName: row.user?.name ?? null,
      after: row.after,
    })),
  };
}

export async function repairSafeDiagnostics(
  user: CurrentUser,
): Promise<{
  duplicateAlertsRemoved: number;
  staysLinked: number;
  reservationRoomsCorrected: number;
}> {
  const report = await getDiagnosticReport();

  let duplicateAlertsRemoved = 0;
  let staysLinked = 0;
  let reservationRoomsCorrected = 0;

  const [repairDuplicateAlerts, repairReservationLinks, repairRoomProjection] = await Promise.all([
    getSettingBool('diagnostics.safeRepairDuplicateAlerts', true),
    getSettingBool('diagnostics.safeRepairReservationLinks', true),
    getSettingBool('diagnostics.safeRepairRoomProjection', true),
  ]);

  await prisma.$transaction(async (tx) => {
    if (repairDuplicateAlerts) for (const group of report.duplicateAlerts.filter((item) => item.safeToRepair)) {
      const [, ...duplicateIds] = group.ids;
      if (duplicateIds.length === 0) continue;
      const updated = await tx.alert.updateMany({
        where: { id: { in: duplicateIds }, deletedAt: null },
        data: {
          deletedAt: new Date(),
          deletionReason: 'Depuración automática: alerta duplicada exacta.',
        },
      });
      duplicateAlertsRemoved += updated.count;
    }

    if (repairReservationLinks) {
      staysLinked = await linkStaysToReservations(tx);
    }

    if (repairRoomProjection) for (const mismatch of report.reservationRoomMismatches) {
      await tx.reservationReference.update({
        where: { id: mismatch.reservationRefId },
        data: { roomNumber: mismatch.expectedRoomNumber },
      });
      reservationRoomsCorrected += 1;
    }

    await recordAudit(
      {
        entity: 'SystemDiagnostics',
        entityId: 'safe-repair',
        action: AuditAction.CONFIGURAR,
        user,
        summary:
          `Depuración segura: ${duplicateAlertsRemoved} alerta(s) duplicada(s), ` +
          `${staysLinked} estadía(s) vinculada(s), ${reservationRoomsCorrected} asignación(es) de habitación corregida(s).`,
        after: {
          duplicateAlertsRemoved,
          staysLinked,
          reservationRoomsCorrected,
          ambiguousStayConflicts: report.duplicateActiveStays.length,
        },
      },
      tx,
    );
  });

  return { duplicateAlertsRemoved, staysLinked, reservationRoomsCorrected };
}
