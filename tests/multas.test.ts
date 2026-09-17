import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { createFine } from '@/server/services/fines';
import {
  fineProblems,
  fineSummary,
  type FineDraft,
} from '@/domain/fines';

const EJEMPLO: FineDraft = {
  reservationCode: '7486899',
  guestName: 'Angela Holzhauer',
  kind: 'BLANCO',
  linenKind: 'TOALLA_MANO',
  stainType: 'Maquillaje lápiz de ojos negro',
  reason: 'Multa: la mancha no se recupera con el lavado habitual.',
};

describe('formulario de multa — quantity', () => {
  it('la cantidad es opcional, pero si viene debe ser entero ≥ 1', () => {
    expect(fineProblems({ ...EJEMPLO, quantity: null })).toEqual([]);
    expect(fineProblems({ ...EJEMPLO, quantity: 3 })).toEqual([]);
    expect(fineProblems({ ...EJEMPLO, quantity: 0 }).map((p) => p.field)).toContain('quantity');
    expect(fineProblems({ ...EJEMPLO, quantity: 1.5 }).map((p) => p.field)).toContain('quantity');
  });
});

describe('resumen de una línea — quantity', () => {
  it('muestra unidades cuando la cantidad es mayor que 1', () => {
    const texto = fineSummary({
      roomNumber: '527',
      kind: 'BLANCO',
      linenKind: 'TOALLA_MANO',
      stainType: 'Vino',
      quantity: 3,
    });
    expect(texto).toBe('Hab. 527 · Toalla de mano · 3 unidades · Vino');
  });
});

describe('multas contra la base — quantity', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('persiste quantity cuando se indica y usa 1 si se omite', async () => {
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

    const conCantidad = await createFine(supervisor, { ...base, quantity: 3 });
    expect(conCantidad.quantity).toBe(3);
    const filaCon = await prisma.fine.findUniqueOrThrow({ where: { id: conCantidad.id } });
    expect(filaCon.quantity).toBe(3);

    const sinCantidad = await createFine(supervisor, base);
    expect(sinCantidad.quantity).toBe(1);
    const filaSin = await prisma.fine.findUniqueOrThrow({ where: { id: sinCantidad.id } });
    expect(filaSin.quantity).toBe(1);
  });
});
