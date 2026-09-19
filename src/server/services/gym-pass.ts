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
  getLiveCashState,
  insertCashMovement,
  type GymPassRow,
  type GymPaymentMethod,
  type LiveCashState,
} from './live-cash';

const ACTIVE_GUEST_STAGES = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];
const ELIGIBLE_GUEST_STATUSES = [RoomStayStatus.IN_HOUSE];

export type GymPassRoomContext = {
  stayId: string;
  reservationCode: string;
  roomNumber: string;
  guestName: string;
};

export function formatGymFolio(folio: number): string {
  return String(folio).padStart(4, '0');
}

function tagValue(tags: string[], prefix: string): string | null {
  return tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export async function getGymPassContextForRoom(
  roomNumber: string,
): Promise<GymPassRoomContext | null> {
  const stay = await prisma.roomStay.findFirst({
    where: {
      deletedAt: null,
      room: { number: roomNumber },
      status: { in: ELIGIBLE_GUEST_STATUSES },
      stage: { in: ACTIVE_GUEST_STAGES },
    },
    orderBy: [{ confirmedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      reservationId: true,
      guestNames: true,
    },
  });

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
    pax: number;
  },
): Promise<{
  id: string;
  folio: number;
  formattedFolio: string;
  passes: Array<{ id: string; folio: number; formattedFolio: string }>;
}> {
  if (!Number.isInteger(params.pax) || params.pax < 1 || params.pax > 20) {
    throw new RuleError('La cantidad de pax debe ser un número entero entre 1 y 20.');
  }

  const [stay, shift] = await Promise.all([
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
        reservationRef: { select: { guestId: true } },
        guestNames: true,
        room: { select: { id: true, number: true } },
      },
    }),
    getMyOpenShift(user.id),
  ]);

  if (!stay) {
    throw new RuleError('Los pases de gimnasio sólo se generan para huéspedes IN_HOUSE.');
  }
  const room = stay.room;
  if (!room) throw new NotFoundError('La estadía no tiene habitación asociada.');
  if (!shift) throw new RuleError('Debes estar asignado al turno vigente para generar un pase.');

  const guestName = stay.guestNames[0]?.trim() || 'Huésped';

  const passes = await prisma.$transaction(async (tx) => {
    const created: Array<{ id: string; folio: number; formattedFolio: string }> = [];

    for (let index = 0; index < params.pax; index += 1) {
      const sequence = await tx.$queryRaw<Array<{ folio: bigint }>>`
        SELECT nextval('"gym_pass_folio_seq"') AS "folio"
      `;
      const folio = Number(sequence[0]?.folio);
      if (!Number.isSafeInteger(folio) || folio < 1000 || folio > 9999) {
        throw new RuleError('No quedan folios de gimnasio de cuatro dígitos disponibles.');
      }
      const formattedFolio = formatGymFolio(folio);

      const entry = await tx.operationalEntry.create({
        data: {
          type: EntryType.HUESPED,
          status: EntryStatus.RESUELTO,
          title: `Pase gimnasio ${formattedFolio}`,
          description:
            `Pase de gimnasio emitido. Folio ${formattedFolio}. ` +
            `Reserva ${stay.reservationId}. Huésped ${guestName}. ` +
            `Habitación ${room.number}. Pax ${index + 1} de ${params.pax}.`,
          category: 'PASE_GIMNASIO',
          roomId: room.id,
          stayId: stay.id,
          reservationId: stay.reservationRefId,
          guestId: stay.reservationRef?.guestId ?? null,
          priority: Priority.BAJA,
          ownerId: user.id,
          shiftId: shift.id,
          occurredAt: new Date(),
          tags: [
            'gimnasio',
            `folio-${formattedFolio}`,
            `reserva-${stay.reservationId}`,
            `stay-${stay.id}`,
            `pax-${index + 1}`,
            `pax-total-${params.pax}`,
          ],
          requiresFollowUp: false,
          resolution: `Folio ${formattedFolio} emitido.`,
          createdById: user.id,
        },
        select: { id: true },
      });

      await recordAudit(
        {
          entity: 'OperationalEntry',
          entityId: entry.id,
          action: AuditAction.CREAR,
          user,
          summary: `Pase de gimnasio ${formattedFolio} · hab. ${room.number} · reserva ${stay.reservationId}`,
          after: {
            folio: formattedFolio,
            stayId: stay.id,
            roomNumber: room.number,
            reservationCode: stay.reservationId,
            guestName,
            paxIndex: index + 1,
            paxTotal: params.pax,
          },
        },
        tx,
      );

      created.push({ id: entry.id, folio, formattedFolio });
    }

    return created;
  });

  const first = passes[0]!;
  return { ...first, passes };
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
  if (!folio) {
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

    /* Compatibilidad con folios históricos que sí representaban una venta. */
    if (currency && amount > 0 && paymentMethod === 'EFECTIVO') {
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
    if (!folioText || !reservationCode || !entry.room) return [];

    const currency = tagValue(entry.tags, 'moneda-') ?? '';
    const rawAmount = tagValue(entry.tags, 'monto-');
    const amount = rawAmount ? Number(rawAmount) : 0;
    const paymentMethod = (tagValue(entry.tags, 'pago-') as GymPaymentMethod | null) ?? 'OTRO';
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
      amount: Number.isFinite(amount) ? amount : 0,
      paymentMethod,
      status: entry.tags.includes('anulado') ? 'ANULADO' as const : 'EMITIDO' as const,
      issuedAt: entry.occurredAt,
      voidReason: entry.tags.includes('anulado')
        ? entry.resolution?.replace(/^Folio \d{4,6} anulado:\s*/, '') ?? null
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
