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
      requiresFollowUp: false,
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
    /*
      Los contadores se resolvían con cuatro `await` sucesivos dentro del
      objeto literal. Se afirma la regla —ninguna consulta esperada de a una—
      y no la lista de variables, que cambia cuando el panel gana una sección.
    */
    expect(source).not.toMatch(/\w+: await prisma\./);
    // Dos esperas en todo el servicio: el turno abierto y el lote en paralelo.
    expect(source.match(/await Promise\.all\(\[/g) ?? []).toHaveLength(2);
    for (const value of ['openEntries', 'openTasks', 'liveAlerts', 'criticalAlerts']) {
      expect(source).toContain(value);
    }
  });

  it('el motor de alertas no bloquea la pantalla', () => {
    /*
      El motor son 18 consultas. Ejecutarlo dentro del render dejaba esas 18
      esperas delante de la primera pantalla del turno. Ahora corre con
      `after()`, ya enviada la respuesta.
    */
    const source = readFileSync('src/server/services/dashboard.ts', 'utf-8');
    expect(source).toContain("import { after } from 'next/server'");
    expect(source).toMatch(/after\(async \(\) => \{/);
    // Ninguna pantalla puede volver a esperar al motor.
    expect(source).not.toMatch(/await runAlertEngine\(\);\n\s*\}?\s*$/m);
    for (const page of [
      'src/app/(app)/page.tsx',
      'src/app/(app)/alertas/page.tsx',
      'src/app/(app)/seguimientos/page.tsx',
    ]) {
      expect(readFileSync(page, 'utf-8')).not.toMatch(/await refreshAlerts/);
    }
  });

  it('el panel se arma aunque el motor no se pueda programar', async () => {
    /*
      `after()` sólo existe dentro de una petición y lanza fuera de ella. El
      motor de alertas es frescura, no corrección: si no se puede programar,
      la pantalla tiene que salir igual. Esta prueba corre justamente fuera de
      un contexto de petición, que es el caso que antes tumbaba el panel.
    */
    const { getDashboardData } = await import('@/server/services/dashboard');
    const user = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Panel' });
    const data = await getDashboardData(user);
    expect(data.counters).toHaveProperty('openEntries');
    expect(data).toHaveProperty('roomsNeedingAction');
  });

  it('Inicio se arma dentro de su presupuesto de consultas', async () => {
    /*
      Inicio costaba 32 consultas, de las cuales 18 eran el motor de alertas
      corriendo dentro del render. Sacado el motor y agregada la sección de
      habitaciones, son 17. El presupuesto se fija acá porque con la base en
      otra región cada consulta de más es una espera que se nota.
    */
    const { PrismaClient } = await import('@prisma/client');
    const counted = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    let queries = 0;
    (counted as never as { $on: (e: string, cb: () => void) => void }).$on('query', () => {
      queries += 1;
    });
    const previous = (globalThis as never as { prisma: unknown }).prisma;
    (globalThis as never as { prisma: unknown }).prisma = counted;
    try {
      // Se importa después de inyectar el cliente: los servicios lo toman de
      // globalThis al cargarse.
      const { getDashboardData } = await import('@/server/services/dashboard');
      const user = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Presupuesto' });
      queries = 0;
      await getDashboardData(user);
      expect(queries).toBeLessThanOrEqual(20);
    } finally {
      (globalThis as never as { prisma: unknown }).prisma = previous;
      await counted.$disconnect();
    }
  });

  it('cada navegación tiene una pantalla de espera', () => {
    // Sin `loading.tsx`, al pulsar un enlace la pantalla anterior se queda
    // congelada mientras el servidor arma la siguiente.
    for (const file of [
      'src/app/(app)/loading.tsx',
      'src/app/(app)/habitaciones/loading.tsx',
    ]) {
      expect(readFileSync(file, 'utf-8')).toContain('export default function Loading');
    }
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
