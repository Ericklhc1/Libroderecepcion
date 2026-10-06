import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlobalSearchResult } from '@/server/services/global-search';
import {
  detailHrefWithListContext,
  detailHrefWithReturnContext,
  listPositionKey,
  listReturnLabel,
  listRowAnchor,
  operationalListHref,
  readListPosition,
  safeListReturnHref,
} from '@/lib/list-navigation';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), search: vi.fn() }));
vi.mock('@/server/auth/guard', () => ({ requirePageUser: mocks.guard }));
vi.mock('@/server/services/global-search', () => ({ searchOperationalRecords: mocks.search }));
import GlobalSearchPage from '@/app/(app)/buscar/page';

const user = { id: 'authorized-search-user', roleKey: 'MUCAMA', permissions: ['housekeeping.view'] };
const result: GlobalSearchResult = {
  humanId: 417, entityType: 'OperationalEntry', entityId: 'canonical-id', kind: 'Novedad',
  title: 'Contexto autorizado <original>', summary: 'Descripción autorizada', status: 'ABIERTO',
  roomNumber: '512', guestName: null, responsible: 'Responsable visible', category: null,
  createdAt: new Date('2026-10-04T12:00:00Z'), href: '/libro/canonical-id',
};
const page = readFileSync('src/app/(app)/buscar/page.tsx', 'utf8');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue(user);
  mocks.search.mockResolvedValue([result]);
});

describe('búsqueda global con retorno al contexto autorizado', () => {
  it('conserva sólo la consulta real, también con espacios, tildes y caracteres de URL', () => {
    const q = 'habitación 512 & #417 / pendiente?';
    const list = operationalListHref('/buscar', { q, pagina: '2', permiso: 'privado', desdeLista: '/admin' });
    expect(list).toBe('/buscar?' + new URLSearchParams({ q }));
    for (const href of ['/libro/canonical-id', '/tareas/canonical-id']) {
      const anchor = listRowAnchor('search', 'OperationalEntry-canonical-id');
      const detail = new URL(detailHrefWithListContext(href, list, anchor), 'https://aroh.invalid');
      expect(detail.pathname).toBe(href);
      const back = safeListReturnHref(detail.searchParams.get('desdeLista'), '/libro');
      expect(back).toBe(`${list}#${anchor}`);
      expect(new URL(back, detail.origin).searchParams.get('q')).toBe(q);
      expect(listReturnLabel(back)).toBe('Volver a resultados');
    }
  });

  it('usa identidad compuesta para que entidades distintas no seleccionen la misma fila', () => {
    const entry = listRowAnchor('search', 'OperationalEntry-shared-id');
    const task = listRowAnchor('search', 'Task-shared-id');
    expect(entry).not.toBe(task);
    expect(readListPosition(JSON.stringify({ rowAnchor: entry, scrollY: 1450.5 })))
      .toEqual({ rowAnchor: entry, scrollY: 1450.5 });
    expect(listPositionKey('user-one', '/buscar?q=512')).not.toBe(listPositionKey('user-two', '/buscar?q=512'));
    expect(listPositionKey('user-one', '/buscar?q=512')).not.toBe(listPositionKey('user-one', '/buscar?q=513'));
  });

  it('continúa entrada y tarea nativas sin perder retorno ni fragmento del detalle', () => {
    const context = '/buscar?q=512#registro-search-Task-task-real';
    expect(detailHrefWithReturnContext('/libro/source-real?modo=consulta#historial-asunto', context))
      .toBe('/libro/source-real?modo=consulta&desdeLista=%2Fbuscar%3Fq%3D512%23registro-search-Task-task-real#historial-asunto');
    expect(new URL(detailHrefWithReturnContext('/tareas/task-real', context), 'https://aroh.invalid').searchParams.get('desdeLista')).toBe(context);
  });

  it('no promete retorno para destinos sin contrato de detalle Libro/Tarea', () => {
    for (const href of ['/seguimientos?seguimiento=real', '/alertas?alerta=real', '/housekeeping?aviso=417', '/caja', '/llaves/personal/real', '/turnos/real', '/libro', '/tareas']) {
      expect(detailHrefWithListContext(href, '/buscar?q=512', 'registro-search-Task-real')).toBe(href);
    }
  });

  it('rechaza retorno externo, ruta manipulada y anclas ajenas sin ampliar parámetros', () => {
    for (const href of ['//evil.invalid/buscar?q=512', 'https://evil.invalid/buscar?q=512', '/buscar/../admin', '/buscar\\evil', '/buscar\n?q=512', '/buscar/record', '/api/buscar']) {
      expect(safeListReturnHref(href, '/libro')).toBe('/libro');
    }
    expect(safeListReturnHref('/buscar?q=512&q=513&estado=privado&pagina=2#otra-ancla', '/libro')).toBe('/buscar?q=512');
    expect(detailHrefWithListContext('/libro/real', '/buscar?q=512', 'registro-search-evil/<script>')).toBe('/libro/real');
    expect(detailHrefWithListContext('/libro/real', `/buscar?q=${'á'.repeat(600)}`, 'registro-search-OperationalEntry-real')).toBe('/libro/real');
  });

  it('autentica con alcance de área y pasa el mismo usuario al único lector autorizado', async () => {
    const html = renderToStaticMarkup(await GlobalSearchPage({ searchParams: Promise.resolve({ q: '  habitación 512  ', estado: 'PRIVADO', pagina: '4' }) }));
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith({ allowAreaOperation: true });
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith(user, 'habitación 512');
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.search.mock.invocationCallOrder[0]!);
    expect(html).toContain('value="habitación 512"');
    expect(html).not.toContain('autofocus');
    expect(html).toContain('id="registro-search-OperationalEntry-canonical-id"');
    expect(html).toContain('href="/libro/canonical-id?desdeLista=%2Fbuscar%3Fq%3Dhabitaci%25C3%25B3n%2B512%23registro-search-OperationalEntry-canonical-id"');
    expect(html).toContain('Contexto autorizado &lt;original&gt;');
    expect(html).not.toContain('estado=PRIVADO');
    expect(page).toContain('scope={user.id}');
    expect(page).not.toMatch(/\bprisma\b|findMany|\$queryRaw|fetch\(/);
  });

  it('no consulta ante entrada vacía, repetida o autenticación interrumpida', async () => {
    for (const params of [{}, { q: '  ' }, { q: ['512', '513'] }]) {
      const html = renderToStaticMarkup(await GlobalSearchPage({ searchParams: Promise.resolve(params) }));
      expect(html).toContain('Escribe un número o una referencia operativa.');
      expect(html).toContain('autofocus');
      expect(html).not.toContain('data-list-item');
    }
    expect(mocks.search).not.toHaveBeenCalled();
    mocks.guard.mockRejectedValueOnce(new Error('Acceso interrumpido'));
    await expect(GlobalSearchPage({ searchParams: Promise.resolve({ q: '512' }) })).rejects.toThrow('Acceso interrumpido');
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('no promete volver a una consulta vacía cuando el contexto supera el límite seguro', async () => {
    const q = 'á'.repeat(600);
    const html = renderToStaticMarkup(await GlobalSearchPage({ searchParams: Promise.resolve({ q }) }));
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith(user, q);
    expect(html).toContain(`value="${q}"`);
    expect(html).toContain('href="/libro/canonical-id"');
    expect(html).not.toContain('desdeLista');
  });

  it('renderiza exclusivamente la proyección del servicio y conserva destinos sin contexto', async () => {
    mocks.search.mockResolvedValueOnce([]);
    const empty = renderToStaticMarkup(await GlobalSearchPage({ searchParams: Promise.resolve({ q: 'reserva' }) }));
    expect(empty).toContain('No encontré registros');
    expect(empty).not.toContain(result.title);
    expect(empty).not.toContain('data-list-item');
    mocks.search.mockResolvedValueOnce([{ ...result, entityType: 'HousekeepingRequest', href: '/housekeeping?aviso=417' }]);
    const hk = renderToStaticMarkup(await GlobalSearchPage({ searchParams: Promise.resolve({ q: '512' }) }));
    expect(hk).toContain('href="/housekeeping?aviso=417"');
    expect(hk).not.toContain('desdeLista');
    expect(hk).not.toContain('Volver a resultados');
  });
});
