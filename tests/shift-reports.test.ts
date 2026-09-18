import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PmsImportStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { getShiftReportsState } from '@/server/services/pms-import';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Estado de cargas PMS.
 *
 * La fecha del informe es contexto histórico, no una fecha de caducidad. El
 * último lote aplicado sigue siendo válido hasta que una carga nueva lo
 * sustituye.
 */
describe('informes del turno', () => {
  let user: CurrentUser;

  const midnight = (date: Date) => {
    const out = new Date(date);
    out.setHours(0, 0, 0, 0);
    return out;
  };

  const batch = async (options: {
    businessDate: Date;
    status: PmsImportStatus;
    counts?: { checkIn: number; inHouse: number; checkOut: number };
  }) =>
    prisma.pmsImportBatch.create({
      data: {
        businessDate: options.businessDate,
        status: options.status,
        reports: [],
        payload: [],
        summary: { counts: options.counts ?? { checkIn: 13, inHouse: 30, checkOut: 14 } },
        createdById: user.id,
        ...(options.status === PmsImportStatus.APLICADO
          ? { appliedAt: new Date(), appliedById: user.id }
          : {}),
      },
    });

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
    user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción mañana' });
  });

  it('sin ningún lote, el día no está cubierto', async () => {
    const state = await getShiftReportsState();
    expect(state.applied).toBeNull();
    expect(state.draft).toBeNull();
  });

  it('un lote aplicado trae sus recuentos', async () => {
    await batch({ businessDate: midnight(new Date()), status: PmsImportStatus.APLICADO });

    const state = await getShiftReportsState();
    expect(state.applied?.counts).toEqual({ checkIn: 13, inHouse: 30, checkOut: 14 });
    expect(state.applied?.appliedByName).toBe('Recepción mañana');
  });

  it('un lote antiguo sigue siendo válido y conserva su fecha de negocio', async () => {
    const yesterday = midnight(new Date(Date.now() - 24 * 3_600_000));
    await batch({ businessDate: yesterday, status: PmsImportStatus.APLICADO });

    const state = await getShiftReportsState();
    expect(state.applied).not.toBeNull();
    expect(midnight(state.applied!.businessDate)).toEqual(yesterday);
  });

  it('un borrador pendiente se anuncia con quién lo cargó', async () => {
    await batch({ businessDate: midnight(new Date()), status: PmsImportStatus.BORRADOR });

    const state = await getShiftReportsState();
    expect(state.draft).not.toBeNull();
    expect(state.draft?.createdByName).toBe('Recepción mañana');
  });

  it('el borrador manda sobre el aplicado: hay trabajo leído sin revisar', async () => {
    const today = midnight(new Date());
    await batch({ businessDate: today, status: PmsImportStatus.APLICADO });
    await batch({ businessDate: today, status: PmsImportStatus.BORRADOR });

    const state = await getShiftReportsState();
    // Ambos se informan: la pantalla prioriza el borrador, pero el servicio
    // no esconde que ya hay un lote aplicado.
    expect(state.draft).not.toBeNull();
  });

  it('un lote descartado no cuenta como cargado', async () => {
    await batch({ businessDate: midnight(new Date()), status: PmsImportStatus.DESCARTADO });

    const state = await getShiftReportsState();
    expect(state.applied).toBeNull();
    expect(state.draft).toBeNull();
  });

  it('el destino de vuelta va por lista blanca, no tal cual', () => {
    /*
      El destino llega en el formulario, así que es entrada del usuario. Si se
      usara tal cual, cualquiera podría hacer que aplicar un informe acabe
      redirigiendo a un sitio ajeno. Se traduce contra una lista cerrada.
    */
    const source = readFileSync('src/server/actions/rooms.ts', 'utf-8');
    expect(source).toContain("const RETURN_TO = { turno: '/turno', habitaciones: '/habitaciones' }");
    // El valor crudo sólo se acepta si es una clave conocida.
    expect(source).toMatch(/raw in RETURN_TO/);
    // Y la redirección usa siempre la tabla, nunca el valor recibido.
    expect(source).toMatch(/redirect\(RETURN_TO\[back\]\)/);
    expect(source).not.toMatch(/redirect\(\s*(raw|back)\s*\)/);
  });

  it('se resuelve en una sola consulta', () => {
    /*
      El inicio de turno ya consulta bastante: este paso tiene que costar un
      solo viaje. Se comprueba sobre el código —una única consulta en el
      cuerpo de la función— porque instrumentar el cliente no funciona con un
      módulo ya importado, y lo que interesa es la regla, no la medición.
    */
    const source = readFileSync('src/server/services/pms-import.ts', 'utf-8');
    const body = source.slice(
      source.indexOf('export async function getShiftReportsState'),
    );
    const fn = body.slice(0, body.indexOf('\n}\n'));
    expect(fn.match(/await prisma\./g) ?? []).toHaveLength(1);
    expect(fn).toContain('pmsImportBatch.findMany');
  });
});
