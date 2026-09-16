import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoomStayStage, RoomStayStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import {
  changeFineStatus,
  createFine,
  fineContextForRoom,
  linkFineToGuarantee,
  listFinesForRoom,
  listOpenFines,
  softDeleteFine,
} from '@/server/services/fines';
import { createGuarantee } from '@/server/services/guarantees';
import { RuleError } from '@/server/errors';
import {
  FINE_STATUS_LABELS,
  LINEN_KIND_LABELS,
  allowedTransitions,
  canTransition,
  fineProblems,
  fineSummary,
  type FineDraft,
} from '@/domain/fines';

/**
 * El formulario real del hotel, con el ejemplo que llegó del mesón.
 *
 * La regla que protegen estas pruebas: una multa que no explica por qué
 * procede el cobro no sirve, porque cuando el huésped la discute lo único que
 * queda es lo que se escribió en el momento.
 */
const EJEMPLO: FineDraft = {
  reservationCode: '7486899',
  guestName: 'Angela Holzhauer',
  kind: 'BLANCO',
  linenKind: 'TOALLA_MANO',
  stainType: 'Maquillaje lápiz de ojos negro',
  reason: 'Multa: la mancha no se recupera con el lavado habitual.',
};

describe('formulario de multa', () => {
  it('el caso real del hotel pasa completo', () => {
    expect(fineProblems(EJEMPLO)).toEqual([]);
  });

  it('devuelve TODOS los problemas, no el primero', () => {
    /*
      Quien está en el mesón con el huésped delante no puede descubrir los
      campos que faltan de uno en uno.
    */
    const problemas = fineProblems({ kind: 'BLANCO' } as FineDraft);
    const campos = problemas.map((p) => p.field);

    expect(problemas.length).toBeGreaterThanOrEqual(5);
    expect(campos).toContain('reservationCode');
    expect(campos).toContain('guestName');
    expect(campos).toContain('reason');
    expect(campos).toContain('linenKind');
    expect(campos).toContain('stainType');
  });

  it('sin motivo del cobro no se registra', () => {
    const problemas = fineProblems({ ...EJEMPLO, reason: '   ' });
    expect(problemas.map((p) => p.field)).toEqual(['reason']);
    expect(problemas[0]?.message).toContain('lo discuta');
  });

  it('una multa de blanco exige el tipo de blanco y el tipo de mancha', () => {
    expect(fineProblems({ ...EJEMPLO, linenKind: null }).map((p) => p.field)).toContain(
      'linenKind',
    );
    expect(fineProblems({ ...EJEMPLO, stainType: '' }).map((p) => p.field)).toContain(
      'stainType',
    );
  });

  it('«otro» blanco exige describirlo', () => {
    const problemas = fineProblems({ ...EJEMPLO, linenKind: 'OTRO' });
    expect(problemas.map((p) => p.field)).toContain('itemDetail');

    expect(
      fineProblems({ ...EJEMPLO, linenKind: 'OTRO', itemDetail: 'Cojín decorativo' }),
    ).toEqual([]);
  });

  it('una multa que no es de blanco no pide tipo de mancha, pero sí el qué', () => {
    const dano: FineDraft = {
      reservationCode: '7486899',
      guestName: 'Angela Holzhauer',
      kind: 'DANO',
      reason: 'Quemadura de cigarrillo en el velador.',
      itemDetail: 'Velador de madera, tapa quemada',
    };
    expect(fineProblems(dano)).toEqual([]);

    // Sin describir qué se dañó, no vale.
    expect(fineProblems({ ...dano, itemDetail: '' }).map((p) => p.field)).toContain(
      'itemDetail',
    );
  });

  it('el monto es opcional, pero si viene tiene que ser positivo', () => {
    expect(fineProblems({ ...EJEMPLO, amount: null })).toEqual([]);
    expect(fineProblems({ ...EJEMPLO, amount: 12_000 })).toEqual([]);
    expect(fineProblems({ ...EJEMPLO, amount: 0 }).map((p) => p.field)).toContain('amount');
    expect(fineProblems({ ...EJEMPLO, amount: -5 }).map((p) => p.field)).toContain('amount');
  });
});

describe('estados de la multa', () => {
  it('una multa cobrada o anulada no vuelve atrás', () => {
    /*
      Si hubo un error, se anula y se registra otra: así queda el rastro de
      las dos, en vez de una que cambió de sentido sin explicación.
    */
    expect(allowedTransitions('COBRADA')).toEqual([]);
    expect(allowedTransitions('ANULADA')).toEqual([]);
    expect(allowedTransitions('CONDONADA')).toEqual([]);
    expect(canTransition('COBRADA', 'REGISTRADA')).toBe(false);
  });

  it('el camino normal es registrar, notificar y cobrar', () => {
    expect(canTransition('REGISTRADA', 'NOTIFICADA')).toBe(true);
    expect(canTransition('NOTIFICADA', 'COBRADA')).toBe(true);
  });

  it('se puede cobrar sin pasar por notificada, y condonar en cualquier punto', () => {
    expect(canTransition('REGISTRADA', 'COBRADA')).toBe(true);
    expect(canTransition('REGISTRADA', 'CONDONADA')).toBe(true);
    expect(canTransition('NOTIFICADA', 'CONDONADA')).toBe(true);
  });

  it('cada estado tiene etiqueta en español', () => {
    for (const estado of Object.keys(FINE_STATUS_LABELS)) {
      expect(FINE_STATUS_LABELS[estado as keyof typeof FINE_STATUS_LABELS]).toBeTruthy();
    }
  });
});

describe('resumen de una línea', () => {
  it('nombra la habitación, el blanco y la mancha', () => {
    const texto = fineSummary({
      roomNumber: '527',
      kind: 'BLANCO',
      linenKind: 'TOALLA_MANO',
      stainType: 'Maquillaje lápiz de ojos negro',
    });
    expect(texto).toBe('Hab. 527 · Toalla de mano · Maquillaje lápiz de ojos negro');
  });

  it('usa el detalle libre cuando el blanco es «otro»', () => {
    const texto = fineSummary({
      roomNumber: '527',
      kind: 'BLANCO',
      linenKind: 'OTRO',
      itemDetail: 'Cojín decorativo',
      stainType: 'Vino',
    });
    expect(texto).toBe('Hab. 527 · Cojín decorativo · Vino');
  });

  it('sin mancha no inventa una', () => {
    const texto = fineSummary({
      roomNumber: '301',
      kind: 'FALTANTE',
      itemDetail: 'Secador de pelo',
    });
    expect(texto).toBe('Hab. 301 · Secador de pelo');
  });

  it('cada tipo de blanco tiene su nombre en español', () => {
    expect(LINEN_KIND_LABELS.TOALLA_MANO).toBe('Toalla de mano');
    for (const value of Object.values(LINEN_KIND_LABELS)) {
      expect(value.length).toBeGreaterThan(3);
    }
  });
});

/**
 * El servicio de multas contra la base real.
 *
 * Lo que se prueba acá y no en el dominio: que el contexto de la habitación se
 * rellene solo, que una multa no se pueda cobrar contra la garantía de otro
 * huésped —el error más caro que puede cometer un mesón— y que condonar exija
 * un motivo.
 */
describe('multas contra la base', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  async function conEstadia(numero: string, reserva: string, huesped: string) {
    const room = await prisma.room.findFirstOrThrow({ where: { number: numero } });
    return prisma.roomStay.create({
      data: {
        roomId: room.id,
        reservationId: reserva,
        guestNames: [huesped],
        status: RoomStayStatus.IN_HOUSE,
        stage: RoomStayStage.CONFIRMADO,
        businessDate: new Date(2026, 8, 14),
        sourceReport: 'IN_HOUSE',
      },
    });
  }

  it('el contexto viene relleno desde la estadía de la habitación', async () => {
    await conEstadia('527', '7486899', 'Angela Holzhauer');

    const contexto = await fineContextForRoom('527');

    /*
      Quien registra la multa tiene al huésped delante: pedirle que
      transcriba el número de reserva es pedirle que se equivoque.
    */
    expect(contexto.reservationCode).toBe('7486899');
    expect(contexto.guestName).toBe('Angela Holzhauer');
    expect(contexto.roomNumber).toBe('527');
    expect(contexto.stayId).not.toBeNull();
  });

  it('una habitación vacía da contexto en blanco, no un error', async () => {
    const contexto = await fineContextForRoom('528');
    expect(contexto.reservationCode).toBe('');
    expect(contexto.guestName).toBe('');
    expect(contexto.stayId).toBeNull();
  });

  it('registra el caso real y lo deja consultable en la habitación', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await conEstadia('527', '7486899', 'Angela Holzhauer');
    const contexto = await fineContextForRoom('527');

    await createFine(supervisor, {
      roomNumber: '527',
      reservationCode: contexto.reservationCode,
      guestName: contexto.guestName,
      stayId: contexto.stayId,
      kind: 'BLANCO',
      linenKind: 'TOALLA_MANO',
      stainType: 'Maquillaje lápiz de ojos negro',
      reason: 'Multa: la mancha no se recupera con el lavado habitual.',
      guestStatement:
        'Según lo que comentó la huésped, encontraba totalmente normal usar la toalla de mano y mancharla al momento de su ducha.',
    });

    const [multa] = await listFinesForRoom('527');
    expect(multa?.reservationCode).toBe('7486899');
    expect(multa?.guestName).toBe('Angela Holzhauer');
    expect(multa?.linenKind).toBe('TOALLA_MANO');
    expect(multa?.stainType).toBe('Maquillaje lápiz de ojos negro');
    expect(multa?.guestStatement).toContain('totalmente normal');
    expect(multa?.status).toBe('REGISTRADA');
    // Queda vinculada a la estadía, no sólo al número escrito.
    expect(multa?.stayId).toBe(contexto.stayId);
  });

  it('una multa sin motivo se rechaza en el servidor, no sólo en el formulario', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await expect(
      createFine(supervisor, {
        roomNumber: '527',
        reservationCode: '7486899',
        guestName: 'Angela Holzhauer',
        kind: 'BLANCO',
        linenKind: 'TOALLA_MANO',
        stainType: 'Vino',
        reason: '',
      }),
    ).rejects.toThrow(RuleError);
    expect(await prisma.fine.count()).toBe(0);
  });

  it('condonar o anular exige un motivo', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const multa = await createFine(supervisor, {
      roomNumber: '527',
      reservationCode: '7486899',
      guestName: 'Angela Holzhauer',
      kind: 'BLANCO',
      linenKind: 'TOALLA_MANO',
      stainType: 'Vino',
      reason: 'Mancha irrecuperable.',
    });

    await expect(
      changeFineStatus(supervisor, { fineId: multa.id, status: 'CONDONADA' }),
    ).rejects.toThrow(/sin motivo/);

    const resuelta = await changeFineStatus(supervisor, {
      fineId: multa.id,
      status: 'CONDONADA',
      note: 'Huésped habitual, se decide no cobrar por una vez.',
    });
    expect(resuelta.status).toBe('CONDONADA');
  });

  it('una multa cobrada no vuelve atrás', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const multa = await createFine(supervisor, {
      roomNumber: '527',
      reservationCode: '7486899',
      guestName: 'Angela Holzhauer',
      kind: 'BLANCO',
      linenKind: 'TOALLA_MANO',
      stainType: 'Vino',
      reason: 'Mancha irrecuperable.',
    });
    await changeFineStatus(supervisor, { fineId: multa.id, status: 'COBRADA' });

    await expect(
      changeFineStatus(supervisor, { fineId: multa.id, status: 'NOTIFICADA' }),
    ).rejects.toThrow(RuleError);
  });

  it('no se puede cobrar contra la garantía de otra reserva', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });

    const reservaA = await prisma.reservationReference.create({
      data: { code: '7486899' },
    });
    const reservaB = await prisma.reservationReference.create({
      data: { code: '9999999' },
    });
    const garantiaDeOtro = await createGuarantee(supervisor, {
      reservationReferenceId: reservaB.id,
      kind: 'TARJETA',
      amount: 50_000,
      currency: 'CLP',
    });

    const multa = await createFine(supervisor, {
      roomNumber: '527',
      reservationCode: '7486899',
      guestName: 'Angela Holzhauer',
      reservationReferenceId: reservaA.id,
      kind: 'BLANCO',
      linenKind: 'TOALLA_MANO',
      stainType: 'Vino',
      reason: 'Mancha irrecuperable.',
    });

    /*
      Cobrarle a un huésped contra la garantía de otro es el error más caro
      que puede cometer un mesón, así que se rechaza en el servidor.
    */
    await expect(
      linkFineToGuarantee(supervisor, {
        fineId: multa.id,
        guaranteeId: garantiaDeOtro.id,
      }),
    ).rejects.toThrow(/otra reserva/);
  });

  it('sí se enlaza con la garantía de su propia reserva', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const reserva = await prisma.reservationReference.create({
      data: { code: '7486899' },
    });
    const garantia = await createGuarantee(supervisor, {
      reservationReferenceId: reserva.id,
      kind: 'TARJETA',
      amount: 50_000,
      currency: 'CLP',
    });
    const multa = await createFine(supervisor, {
      roomNumber: '527',
      reservationCode: '7486899',
      guestName: 'Angela Holzhauer',
      reservationReferenceId: reserva.id,
      kind: 'BLANCO',
      linenKind: 'TOALLA_MANO',
      stainType: 'Vino',
      reason: 'Mancha irrecuperable.',
    });

    await linkFineToGuarantee(supervisor, { fineId: multa.id, guaranteeId: garantia.id });

    const fila = await prisma.fine.findUniqueOrThrow({ where: { id: multa.id } });
    expect(fila.guaranteeId).toBe(garantia.id);
  });

  it('eliminar una multa es lógico y exige motivo', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const multa = await createFine(supervisor, {
      roomNumber: '527',
      reservationCode: '7486899',
      guestName: 'Angela Holzhauer',
      kind: 'BLANCO',
      linenKind: 'TOALLA_MANO',
      stainType: 'Vino',
      reason: 'Mancha irrecuperable.',
    });

    await softDeleteFine(supervisor, {
      fineId: multa.id,
      reason: 'Se registró en la habitación equivocada.',
    });

    const fila = await prisma.fine.findUniqueOrThrow({ where: { id: multa.id } });
    expect(fila.deletedAt).not.toBeNull();
    expect(fila.deletionReason).toContain('equivocada');
    // Y deja de listarse.
    expect(await listFinesForRoom('527')).toHaveLength(0);
  });

  it('sólo lo abierto llega a Supervisión', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const base = {
      roomNumber: '527',
      reservationCode: '7486899',
      guestName: 'Angela Holzhauer',
      kind: 'BLANCO' as const,
      linenKind: 'TOALLA_MANO' as const,
      stainType: 'Vino',
      reason: 'Mancha irrecuperable.',
    };
    const abierta = await createFine(supervisor, base);
    const cerrada = await createFine(supervisor, base);
    await changeFineStatus(supervisor, { fineId: cerrada.id, status: 'COBRADA' });

    const abiertas = await listOpenFines();
    expect(abiertas.map((f) => f.id)).toContain(abierta.id);
    expect(abiertas.map((f) => f.id)).not.toContain(cerrada.id);
  });
});
