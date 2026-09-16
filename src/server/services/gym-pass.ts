import 'server-only';

import {
  AuditAction,
  EntryStatus,
  EntryType,
  Priority,
  RoomStayStage,
  RoomStayStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import { NotFoundError, RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';
import { getMyOpenShift } from './shifts';
import {
  formatGymFolio,
  getLiveCashState,
  gymPrices,
  insertCashMovement,
  type GymPassRow,
  type GymPaymentMethod,
  type LiveCashState,
} from './live-cash';

const ACTIVE_GUEST_STAGES = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];
const ELIGIBLE_GUEST_STATUSES = [RoomStayStatus.IN_HOUSE, RoomStayStatus.CHECK_OUT];

export type GymPassRoomContext = {
  stayId: string;
  reservationCode: string;
  roomNumber: string;
  guestName: string;
};

function tagValue(tags: string[], prefix: string): string | null {
  return tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export async function getGymPassContextForRoom(
  roomNumber: string,
): Promise<GymPassRoomContext | null> {
  const stays = await prisma.roomStay.findMany({
    where: {
      deletedAt: null,
      room: { number: roomNumber },
      status: { in: ELIGIBLE_GUEST_STATUSES },
      stage: { in: ACTIVE_GUEST_STAGES },
    },
    select: {
      id: true,
      status: true,
      reservationId: true,
      guestNames: true,
    },
  });

  const stay =
    stays.find((item) => item.status === RoomStayStatus.IN_HOUSE) ??
    stays.find((item) => item.status === RoomStayStatus.CHECK_OUT) ??
    null;

  if (!stay) return null;

  return {
    stayId: stay.id,
    reservationCode: stay.reservationId,
    roomNumber,
    guestName: stay.guestNames[0] || 'Huésped',
  };
}

export async function createGymPass(
  user: CurrentUser,
  params: {
    stayId: string;
    currency: 'CLP' | 'USD';
    paymentMethod: GymPaymentMethod;
  },
): Promise<{ id: string; folio: number; formattedFolio: string }> {
  const [stay, prices, shift] = await Promise.all([
    prisma.roomStay.findFirst({
      where: {
        id: params.stayId,
        deletedAt: null,
        status: { in: ELIGIBLE_GUEST_STATUSES },
        stage: { in: ACTIVE_GUEST_STAGES },
      },
      select: {
        id: true,
        reservationId: true,
        reservationRefId: true,
        guestNames: true,
        room: { select: { id: true, number: true } },
      },
    }),
    gymPrices(),
    getMyOpenShift(user.id),
  ]);

  if (!stay) {
    throw new RuleError(
      'El pase de gimnasio sólo se puede vender a huéspedes IN_HOUSE o CHECK_OUT cuya salida todavía no haya sido confirmada.',
    );
  }
  if (!stay.room) throw new NotFoundError('La estadía no tiene habitación asociada.');
  if (!shift) throw new RuleError('Debes estar asignado al turno vigente para vender un pase.');

  const guestName = stay.guestNames[0]?.trim() || 'Huésped';
  const amount = params.currency === 'CLP' ? prices.CLP : prices.USD;
  if (!(amount > 0)) throw new RuleError('El precio del pase no está configurado correctamente.');

  return prisma.$transaction(async (tx) => {
    const sequence = await tx.$queryRaw<Array<{ folio: bigint }>>`
      SELECT nextval('"gym_pass_folio_seq"') AS "folio"
    `;
    const folio = Number(sequence[0]?.folio);
    if (!Number.isSafeInteger(folio) || folio < 1 || folio > 999999) {
      throw new RuleError('No quedan folios de gimnasio disponibles.');
    }
    const formattedFolio = formatGymFolio(folio);

    const entry = await tx.operationalEntry.create({
      data: {
        type: EntryType.CAJA,
        status: EntryStatus.RESUELTO,
        title: `Pase gimnasio ${formattedFolio}`,
        description:
          `Pase de gimnasio emitido. Folio ${formattedFolio}. ` +
          `Reserva ${stay.reservationId}. Huésped ${guestName}. ` +
          `Habitación ${stay.room.number}. ${params.currency} ${amount}. ` +
          `Pago: ${params.paymentMethod.toLowerCase()}.`,
        category: 'PASE_GIMNASIO',
        roomId: stay.room.id,
        reservationId: stay.reservationRefId,
        priority: Priority.BAJA,
        ownerId: user.id,
        shiftId: shift.id,
        occurredAt: new Date(),
        tags: [
          'gimnasio',
          `folio-${formattedFolio}`,
          `reserva-${stay.reservationId}`,
          `stay-${stay.id}`,
          `moneda-${params.currency}`,
          `monto-${amount}`,
          `pago-${params.paymentMethod}`,
        ],
        requiresFollowUp: false,
        resolution: `Folio ${formattedFolio} emitido.`,
        createdById: user.id,
      },
      select: { id: true },
    });

    if (params.paymentMethod === 'EFECTIVO') {
      await insertCashMovement(tx, {
        userId: user.id,
        kind: 'VENTA_GIMNASIO',
        direction: 'ENTRADA',
        currency: params.currency,
        amount,
        shiftId: shift.id,
        roomId: stay.room.id,
        reservationReferenceId: stay.reservationRefId,
        reference: `Folio ${formattedFolio} · reserva ${stay.reservationId}`,
        notes: `Pase de gimnasio · ${guestName} · registro ${entry.id}`,
      });
    }

    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: entry.id,
        action: AuditAction.CREAR,
        user,
        summary: `Pase de gimnasio ${formattedFolio} · hab. ${stay.room.number} · reserva ${stay.reservationId} · ${params.currency} ${amount}`,
        after: {
          folio: formattedFolio,
          stayId: stay.id,
          roomNumber: stay.room.number,
          reservationCode: stay.reservationId,
          guestName,
          currency: params.currency,
          amount,
          paymentMethod: params.paymentMethod,
        },
      },
      tx,
    );

    return { id: entry.id, folio, formattedFolio };
  });
}

export async function voidGymPass(
  user: CurrentUser,
  params: { id: string; reason: string },
): Promise<void> {
  const entry = await prisma.operationalEntry.findFirst({
    where: { id: params.id, category: 'PASE_GIMNASIO', deletedAt: null },
    include: { room: { select: { id: true, number: true } } },
  });
  if (!entry) throw new NotFoundError('Ese folio no existe.');
  if (entry.tags.includes('anulado')) throw new RuleError('Ese folio ya está anulado.');
  if (params.reason.trim().length < 5) throw new RuleError('Indica el motivo de anulación.');

  const folio = tagValue(entry.tags, 'folio-');
  const currency = tagValue(entry.tags, 'moneda-');
  const amount = Number(tagValue(entry.tags, 'monto-'));
  const paymentMethod = tagValue(entry.tags, 'pago-') as GymPaymentMethod | null;
  const reservationCode = tagValue(entry.tags, 'reserva-');
  if (!folio || !currency || !(amount > 0) || !paymentMethod) {
    throw new RuleError('El folio no tiene datos suficientes para anularse de forma segura.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.operationalEntry.update({
      where: { id: entry.id },
      data: {
        status: EntryStatus.CERRADO,
        resolution: `Folio ${folio} anulado: ${params.reason.trim()}`,
        closedAt: new Date(),
        closedById: user.id,
        tags: { push: 'anulado' },
      },
    });

    if (paymentMethod === 'EFECTIVO') {
      const reversalReference = `Anulación folio ${folio}`;
      const existing = await tx.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS(
          SELECT 1 FROM "CashMovement"
          WHERE "kind" = 'ANULACION_GIMNASIO'
            AND "reference" = ${reversalReference}
            AND "voidedAt" IS NULL
        ) AS "exists"
      `;
      if (!existing[0]?.exists) {
        await insertCashMovement(tx, {
          userId: user.id,
          kind: 'ANULACION_GIMNASIO',
          direction: 'SALIDA',
          currency,
          amount,
          shiftId: entry.shiftId,
          roomId: entry.roomId,
          reference: reversalReference,
          notes: `${params.reason.trim()} · reserva ${reservationCode ?? '—'}`,
        });
      }
    }

    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: entry.id,
        action: AuditAction.CAMBIO_ESTADO,
        user,
        summary: `Folio de gimnasio ${folio} anulado: ${params.reason.trim()}`,
        before: { status: entry.status },
        after: { status: EntryStatus.CERRADO, reason: params.reason.trim() },
      },
      tx,
    );
  });
}

async function listGymPassRows(limit: number): Promise<GymPassRow[]> {
  const entries = await prisma.operationalEntry.findMany({
    where: { category: 'PASE_GIMNASIO', deletedAt: null },
    include: {
      room: { select: { number: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { occurredAt: 'desc' },
    take: limit,
  });

  return entries.flatMap((entry) => {
    const folioText = tagValue(entry.tags, 'folio-');
    const reservationCode = tagValue(entry.tags, 'reserva-');
    const currency = tagValue(entry.tags, 'moneda-');
    const amount = Number(tagValue(entry.tags, 'monto-'));
    const paymentMethod = tagValue(entry.tags, 'pago-') as GymPaymentMethod | null;
    if (!folioText || !reservationCode || !currency || !(amount > 0) || !paymentMethod || !entry.room) {
      return [];
    }

    const folio = Number(folioText);
    const guestMatch = entry.description.match(/Huésped (.*?)\. Habitación/);
    return [{
      id: entry.id,
      folio,
      reservationCode,
      roomNumber: entry.room.number,
      guestName: guestMatch?.[1] ?? 'Huésped',
      receptionistName: entry.createdBy.name,
      currency,
      amount,
      paymentMethod,
      status: entry.tags.includes('anulado') ? 'ANULADO' as const : 'EMITIDO' as const,
      issuedAt: entry.occurredAt,
      voidReason: entry.tags.includes('anulado')
        ? entry.resolution?.replace(/^Folio \d{6} anulado:\s*/, '') ?? null
        : null,
    }];
  });
}

export async function getLiveCashStateWithGym(limit = 30): Promise<LiveCashState> {
  const [state, gymPasses] = await Promise.all([
    getLiveCashState(limit),
    listGymPassRows(limit),
  ]);
  return { ...state, gymPasses };
}
