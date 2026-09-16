import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { seedCatalog } from '@/domain/catalog';
import { ROLE_DEFINITIONS } from '@/lib/permissions';
import { roomNumbers } from '@/domain/catalog';

/**
 * Coste de la siembra del catálogo, medido en consultas.
 *
 * Esta prueba existe por un error real: la primera versión hacía un `upsert`
 * por fila —más de doscientas consultas— y funcionaba perfecto contra una base
 * local. En el despliegue real, con la base a 120 ms de distancia, la
 * transacción de la instalación se agotaba y el sistema no se podía instalar.
 *
 * El número de filas no importa; lo que importa es que el número de consultas
 * no crezca con ellas.
 */
const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });

afterAll(async () => {
  await client.$disconnect();
});

describe('siembra del catálogo', () => {
  it('no hace una consulta por fila', async () => {
    let queries = 0;
    client.$on('query', () => {
      queries += 1;
    });

    await seedCatalog(client, { hotelName: 'Hotel de prueba' });

    const rows = roomNumbers().length;
    expect(rows).toBeGreaterThan(80);
    /*
      Con una veintena de consultas hay margen de sobra para la decena que
      hace la versión por lotes, y muy lejos de las más de doscientas que
      haría una consulta por fila.
     */
    expect(queries).toBeLessThan(40);
  });

  it('es idempotente: repetirla no duplica nada', async () => {
    // Se compara contra el estado previo, no contra números absolutos: otras
    // pruebas pueden haber dejado llaves adicionales en la base.
    const before = {
      rooms: await client.room.count(),
      keys: await client.roomKey.count(),
      roles: await client.role.count(),
      permissions: await client.permission.count(),
    };

    await seedCatalog(client);

    expect(await client.room.count()).toBe(before.rooms);
    expect(await client.roomKey.count()).toBe(before.keys);
    expect(await client.permission.count()).toBe(before.permissions);
    expect(before.roles).toBe(ROLE_DEFINITIONS.length);
  });

  it('no deja ninguna habitación sin llave principal', async () => {
    const sinLlave = await client.room.count({
      where: { keys: { none: { type: 'PRINCIPAL' } } },
    });
    expect(sinLlave).toBe(0);
  });

  it('deja cada llave principal ligada a su habitación', async () => {
    const orphans = await client.roomKey.count({
      where: { type: 'PRINCIPAL', roomId: null },
    });
    expect(orphans).toBe(0);
  });
});
