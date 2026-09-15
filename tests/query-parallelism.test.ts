import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROLE_KEYS, createUser, resetOperationalData, seedCatalog } from './helpers';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { getBookItems } from '@/server/services/book';
import { EntryType, Priority } from '@prisma/client';

/**
 * Las consultas independientes tienen que viajar juntas.
 *
 * Esta prueba existe por la misma razón que la de la siembra: contra una base
 * local, encadenar esperas no se nota; con la base en otra región cada espera
 * cuesta un viaje completo. El libro consultaba sus cuatro fuentes una detrás
 * de otra, de modo que abrirlo costaba cuatro viajes en vez de uno.
 *
 * No se mide el tiempo —sería frágil—, se mide el solapamiento: si las cuatro
 * consultas arrancan antes de que termine la primera, van en paralelo.
 */
describe('paralelismo de consultas', () => {
  beforeAll(async () => {
    await seedCatalog();
    await resetOperationalData();
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Cambio de tarifa del grupo',
      description: 'Se ajustó la tarifa del grupo que llega mañana.',
      priority: Priority.MEDIA,
      tags: [],
    });
    await createTask(user, {
      title: 'Confirmar traslados',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
    });
  });

  it('el libro lanza sus cuatro fuentes en paralelo', () => {
    /*
      Se comprueba sobre el código: el `Promise.all` con las cuatro fuentes es
      justamente lo que se perdería si alguien volviera a poner un `await` por
      bloque, y es una condición estructural, no de tiempo de ejecución.
    */
    const source = readFileSync('src/server/services/book.ts', 'utf-8');
    const parallel = source.slice(source.indexOf('await Promise.all(['));
    for (const fn of ['entryItems()', 'taskItems()', 'followUpItems()', 'alertItems()']) {
      expect(parallel).toContain(fn);
    }
    // Ninguna fuente puede quedar esperando a la anterior.
    expect(source).not.toMatch(/const \w+ = await (entry|task|followUp|alert)Items\(\)/);
  });

  it('el panel principal no encadena sus contadores', () => {
    const source = readFileSync('src/server/services/dashboard.ts', 'utf-8');
    // Los contadores se resolvían con cuatro `await` sucesivos dentro del objeto.
    expect(source).not.toMatch(/openEntries: await prisma/);
    expect(source).toMatch(/\[nextShift, shiftMetrics, openEntries, openTasks/);
  });

  it('la supervisión resuelve todos sus bloques en una sola espera', () => {
    const source = readFileSync('src/server/services/supervision.ts', 'utf-8');
    const awaits = source.match(/await /g) ?? [];
    // Una sola espera: la del Promise.all que agrupa las nueve consultas.
    expect(awaits).toHaveLength(1);
    expect(source).toContain('await Promise.all([');
  });

  it('el resultado del libro sigue ordenado y completo tras el cambio', async () => {
    const result = await getBookItems({});
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    // Mezcla clases distintas en una misma línea temporal…
    expect(new Set(result.items.map((item) => item.kind)).size).toBeGreaterThan(1);
    // …y respeta el orden cronológico descendente.
    const dates = result.items.map((item) => item.date.getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('filtrar por clase devuelve sólo esa clase', async () => {
    const tasks = await getBookItems({ kinds: ['task'] });
    expect(tasks.items.length).toBeGreaterThan(0);
    expect(tasks.items.every((item) => item.kind === 'task')).toBe(true);
  });
});
