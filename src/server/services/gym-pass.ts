import 'server-only';

import { randomUUID } from 'node:crypto';
import { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import { NotFoundError, RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';
import { calendarDateKey } from '@/domain/time';
import { getLiveCashState, insertCashMovement, type LiveCashState } from './live-cash';
import { getMyOpenShift } from './shifts';

export type GymPassRow = {
  id: string;
  folio: number;
  formattedFolio: string;
  serviceDate: Date;
  roomNumber: string;
  guestName: string;
  receptionistName: string;
  status: 'EMITIDO' | 'ANULADO';
  issuedAt: Date;
  voidReason: string | null;
};

export type GymPassSummary = {
  rows: GymPassRow[];
  total: number;
  emitted: number;
  voided: number;
};

export function formatGymFolio(folio: number): string {
  return String(folio).padStart(4, '0');
}

function normalizeServiceDate(value: string | Date): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RuleError('La fecha del folio no es válida.');
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new RuleError('La fecha del folio no es válida.');
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || calendarDateKey(date) !== raw) {
    throw new RuleError('La fecha del folio no es válida.');
  }
  return date;
}

export async function createGymPass(
  user: CurrentUser,
  params: {
    serviceDate: string | Date;
    roomNumber: string;
    guestName: string;
  },
): Promise<{ id: string; folio: number; formattedFolio: string }> {
  const roomNumber = params.roomNumber.trim();
  const guestName = params.guestName.trim();
  if (!roomNumber) throw new RuleError('Indica la habitación.');
  if (!guestName) throw new RuleError('Indica el huésped.');

  const shift = await getMyOpenShift(user.id);
  if (!shift) {
    throw new RuleError('Debes estar asignado a un turno operativo para emitir un folio.');
  }

  const serviceDate = normalizeServiceDate(params.serviceDate);
  const id = randomUUID();

  const pass = await prisma.$transaction(async (tx) => {
    const created = await tx.gymPass.create({
      data: {
        id,
        serviceDate,
        roomNumber,
        guestName,
        receptionistId: user.id,
        shiftId: shift.id,
      },
      select: {
        id: true,
        folio: true,
        serviceDate: true,
        roomNumber: true,
        guestName: true,
      },
    });

    await recordAudit(
      {
        entity: 'GymPass',
        entityId: created.id,
        action: AuditAction.CREAR,
        user,
        summary:
          `Folio de gimnasio ${formatGymFolio(created.folio)} · ` +
          `${calendarDateKey(created.serviceDate)} · hab. ${created.roomNumber} · ${created.guestName}`,
        after: {
          folio: formatGymFolio(created.folio),
          serviceDate: calendarDateKey(created.serviceDate),
          roomNumber: created.roomNumber,
          guestName: created.guestName,
          receptionistId: user.id,
          receptionistName: user.name,
          shiftId: shift.id,
        },
      },
      tx,
    );

    return created;
  });

  return {
    id: pass.id,
    folio: pass.folio,
    formattedFolio: formatGymFolio(pass.folio),
  };
}

export async function voidGymPass(
  user: CurrentUser,
  params: { id: string; reason: string },
): Promise<void> {
  const reason = params.reason.trim();
  if (reason.length < 5) throw new RuleError('Indica el motivo de anulación.');

  const pass = await prisma.gymPass.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      folio: true,
      status: true,
      serviceDate: true,
      roomNumber: true,
      guestName: true,
      shiftId: true,
      operationalEntryId: true,
      currency: true,
      amount: true,
      paymentMethod: true,
      roomId: true,
      reservationReferenceId: true,
    },
  });
  if (!pass) throw new NotFoundError('Ese folio no existe.');
  if (pass.status === 'ANULADO') throw new RuleError('Ese folio ya está anulado.');

  const formattedFolio = formatGymFolio(pass.folio);

  await prisma.$transaction(async (tx) => {
    await tx.gymPass.update({
      where: { id: pass.id },
      data: {
        status: 'ANULADO',
        voidedAt: new Date(),
        voidedById: user.id,
        voidReason: reason,
      },
    });

    // Compatibilidad histórica: folios antiguos podían crear una entrada del Libro.
    if (pass.operationalEntryId) {
      await tx.operationalEntry.updateMany({
        where: { id: pass.operationalEntryId, deletedAt: null },
        data: {
          status: 'CERRADO',
          resolution: `Folio ${formattedFolio} anulado: ${reason}`,
          closedAt: new Date(),
          closedById: user.id,
        },
      });
    }

    // Compatibilidad histórica: un folio antiguo podía haber registrado cobro en efectivo.
    if (
      pass.paymentMethod === 'EFECTIVO' &&
      pass.currency &&
      pass.amount &&
      Number(pass.amount) > 0
    ) {
      const existing = await tx.cashMovement.findFirst({
        where: {
          gymPassId: pass.id,
          kind: 'ANULACION_GIMNASIO',
          voidedAt: null,
        },
        select: { id: true },
      });
      if (!existing) {
        await insertCashMovement(tx, {
          userId: user.id,
          kind: 'ANULACION_GIMNASIO',
          direction: 'SALIDA',
          currency: pass.currency,
          amount: Number(pass.amount),
          shiftId: pass.shiftId,
          roomId: pass.roomId,
          reservationReferenceId: pass.reservationReferenceId,
          gymPassId: pass.id,
          reference: `Anulación folio ${formattedFolio}`,
          notes: reason,
        });
      }
    }

    await recordAudit(
      {
        entity: 'GymPass',
        entityId: pass.id,
        action: AuditAction.CAMBIO_ESTADO,
        user,
        summary: `Folio de gimnasio ${formattedFolio} anulado: ${reason}`,
        before: { status: pass.status },
        after: { status: 'ANULADO', reason },
      },
      tx,
    );
  });
}

export async function listGymPasses(params: {
  from?: string | Date | null;
  to?: string | Date | null;
  limit?: number;
} = {}): Promise<GymPassSummary> {
  const from = params.from ? normalizeServiceDate(params.from) : null;
  const to = params.to ? normalizeServiceDate(params.to) : null;
  if (from && to && from.getTime() > to.getTime()) {
    throw new RuleError('La fecha «desde» no puede ser posterior a «hasta».');
  }

  const limit = Math.min(1000, Math.max(1, params.limit ?? 200));

  const passes = await prisma.gymPass.findMany({
    where: {
      ...(from || to
        ? {
            serviceDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    include: {
      receptionist: { select: { name: true } },
    },
    orderBy: [{ serviceDate: 'desc' }, { folio: 'desc' }],
    take: limit,
  });

  const rows: GymPassRow[] = passes.map((pass) => ({
    id: pass.id,
    folio: pass.folio,
    formattedFolio: formatGymFolio(pass.folio),
    serviceDate: pass.serviceDate,
    roomNumber: pass.roomNumber,
    guestName: pass.guestName,
    receptionistName: pass.receptionist.name,
    status: pass.status === 'ANULADO' ? 'ANULADO' : 'EMITIDO',
    issuedAt: pass.issuedAt,
    voidReason: pass.voidReason,
  }));

  return {
    rows,
    total: rows.length,
    emitted: rows.filter((row) => row.status === 'EMITIDO').length,
    voided: rows.filter((row) => row.status === 'ANULADO').length,
  };
}

export async function getLiveCashStateWithGym(limit = 30): Promise<LiveCashState> {
  const [state, summary] = await Promise.all([
    getLiveCashState(limit),
    listGymPasses({ limit }),
  ]);

  return {
    ...state,
    gymPasses: summary.rows.map((row) => ({
      id: row.id,
      folio: row.folio,
      reservationCode: '',
      roomNumber: row.roomNumber,
      guestName: row.guestName,
      receptionistName: row.receptionistName,
      currency: '',
      amount: 0,
      paymentMethod: 'OTRO',
      status: row.status,
      issuedAt: row.issuedAt,
      voidReason: row.voidReason,
    })),
  };
}
