import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The continuity boundary must remain a native document link even if the
// framework's client transition is unavailable. Reintroducing next/link makes
// the server-rendered link regressions below fail instead of masking the stall.
vi.mock('next/link', () => ({
  default: () => { throw new Error('List/detail continuity must not depend on a client-router transition'); },
}));
import {
  detailHrefWithListContext,
  detailHrefWithReturnContext,
  listPositionKey,
  listReturnKey,
  listReturnLabel,
  listRowAnchor,
  operationalListHref,
  readListPosition,
  safeListReturnHref,
} from '@/lib/list-navigation';
import { ListItemLink, ListNavigation, ListReturnLink } from '@/components/operational/list-navigation';

describe('continuidad nativa entre lista y detalle', () => {
  const filters = {
    q: 'ruido & #417', clase: 'entry', tipo: 'INCIDENCIA', estado: 'EN_CURSO',
    prioridad: 'ALTA', area: 'recepcion', responsable: 'persona-real', turno: 'turno-real',
    desde: '2026-10-04', hasta: '2026-10-05', pagina: '3', eliminados: '1',
  };

  it('conserva búsqueda, filtros, pestaña, página y selección con ID canónico', () => {
    const list = operationalListHref('/libro', filters);
    const anchor = listRowAnchor('entry', 'cm-real-123');
    const detail = new URL(detailHrefWithListContext('/libro/cm-real-123', list, anchor), 'https://aroh.invalid');
    expect(detail.pathname).toBe('/libro/cm-real-123');
    const back = safeListReturnHref(detail.searchParams.get('desdeLista'), '/libro');
    const url = new URL(back, detail.origin);
    expect(url.pathname).toBe('/libro');
    expect(Object.fromEntries(url.searchParams)).toEqual(filters);
    expect(url.hash).toBe('#registro-entry-cm-real-123');
  });

  it('una tarea vuelve a su lista real, tanto desde Libro como desde Tareas', () => {
    for (const list of ['/libro?clase=task&q=pendiente&pagina=2', '/tareas?mias=1&estado=ACEPTADA&q=pendiente']) {
      const href = detailHrefWithListContext('/tareas/task-real', list, listRowAnchor('task', 'task-real'));
      const url = new URL(href, 'https://aroh.invalid');
      expect(url.pathname).toBe('/tareas/task-real');
      expect(safeListReturnHref(url.searchParams.get('desdeLista'), '/tareas')).toBe(`${list}#registro-task-task-real`);
    }
  });

  it('continúa entrada → tarea → entrada con el mismo retorno sin alterar los IDs', () => {
    const context = '/libro?tipo=INCIDENCIA&pagina=3#registro-entry-origen';
    for (const href of ['/tareas/trabajo-real', '/libro/origen']) {
      const url = new URL(detailHrefWithReturnContext(href, context), 'https://aroh.invalid');
      expect(url.pathname).toBe(href);
      expect(url.searchParams.get('desdeLista')).toBe(context);
      expect(detailHrefWithReturnContext(href, undefined)).toBe(href);
      expect(detailHrefWithReturnContext(href, '//evil.invalid')).toBe(href);
    }
  });

  it('retiene rutas directas y fragmentos existentes sin fabricar entidades', () => {
    expect(detailHrefWithListContext('/tareas/real?modo=consulta#historial-asunto', '/tareas', 'registro-task-real'))
      .toBe('/tareas/real?modo=consulta&desdeLista=%2Ftareas%23registro-task-real#historial-asunto');
    for (const href of ['/seguimientos', '/alertas?alerta=real', '/housekeeping?aviso=417']) {
      expect(detailHrefWithListContext(href, '/libro', 'registro-task-real')).toBe(href);
    }
    expect(safeListReturnHref(undefined, '/libro')).toBe('/libro');
    expect(safeListReturnHref(undefined, '/tareas')).toBe('/tareas');
  });

  it.each([
    'https://evil.invalid/libro', '//evil.invalid/libro', '/\\evil.invalid/libro',
    'javascript:alert(1)', 'data:text/html,evil', '/libro/../../admin', '/libro/../tareas',
    '/libro/%2e%2e/tareas', '/%6cibro', '/libro%2ftareas', '/libro%3fq=x',
    '/libro-secreta', '/libro/real', '/api/libro/reporte', ' /libro', '/libro\n',
    '/libro\t', '/libro\u0000', '/tareas\\real', ['/libro', '//evil.invalid'],
  ].map(value => ({ value })))('rechaza un retorno ajeno o ambiguo: $value', ({ value }) => {
    expect(safeListReturnHref(value, '/tareas')).toBe('/tareas');
  });

  it('limita parámetros a filtros existentes y descarta anclas no canónicas', () => {
    expect(safeListReturnHref('/libro?q=uno&q=dos&desdeLista=https%3A%2F%2Fevil.invalid&next=%2Fadmin#fake', '/tareas'))
      .toBe('/libro?q=uno');
    expect(operationalListHref('/tareas', { q: ['primero', 'segundo'], mias: '1', page: 'fake', desdeLista: '/admin' }))
      .toBe('/tareas?q=primero&mias=1');
    expect(safeListReturnHref(`/libro?q=${'x'.repeat(2000)}`, '/libro')).toBe('/libro');
    expect(detailHrefWithListContext('/libro/real', `/libro?q=${'á'.repeat(600)}`, 'registro-entry-real')).toBe('/libro/real');
  });

  it('almacena sólo selección y posición válidas, aisladas por usuario y lista', () => {
    const snapshot = { rowAnchor: 'registro-task-real', scrollY: 1534.5 };
    expect(readListPosition(JSON.stringify(snapshot))).toEqual(snapshot);
    for (const value of [null, '', 'incompleto', '{}', 'null', '[]', '{"rowAnchor":"otra","scrollY":20}',
      '{"rowAnchor":"registro-task-real","scrollY":-1}', '{"rowAnchor":"registro-task-real","scrollY":"400"}',
      '{"rowAnchor":"registro-task-real","scrollY":10000001}']) expect(readListPosition(value)).toBeNull();
    expect(listPositionKey('uno', '/libro?q=uno')).not.toBe(listPositionKey('dos', '/libro?q=uno'));
    expect(listPositionKey('uno', '/libro?q=uno')).not.toBe(listPositionKey('uno', '/libro?q=dos'));
    expect(listPositionKey('uno', '/libro#registro-entry-real')).toBe(listPositionKey('uno', '/libro'));
    expect(listReturnKey('uno')).not.toBe(listReturnKey('dos'));
  });

  it('renderiza enlaces reales accesibles, también sin JavaScript', () => {
    const html = renderToStaticMarkup(
      <ListNavigation href="/libro?clase=task&pagina=2" scope="usuario">
        <ListItemLink href="/tareas/id-canonico" rowAnchor="registro-task-id-canonico">Tarea #417</ListItemLink>
      </ListNavigation>,
    );
    expect(html).toContain('id="registro-task-id-canonico"');
    expect(html).toMatch(/^<a\s/);
    expect(html).not.toContain('target="');
    expect(html).toContain('href="/tareas/id-canonico?desdeLista=%2Flibro%3Fclase%3Dtask%26pagina%3D2%23registro-task-id-canonico"');
    const direct = renderToStaticMarkup(<ListItemLink href="/libro/id-canonico" rowAnchor="registro-entry-id-canonico">Novedad #418</ListItemLink>);
    expect(direct).toContain('href="/libro/id-canonico"');
    expect(direct).not.toContain('desdeLista');
    const back = renderToStaticMarkup(<ListReturnLink href="/libro?clase=task" scope="usuario" />);
    expect(back).toMatch(/^<a\s/);
    expect(back).toContain('href="/libro?clase=task"');
    expect(back).toContain('Volver a la lista de tareas');
    expect(back).not.toContain('target="');
    expect(listReturnLabel('/libro?tipo=INCIDENCIA')).toBe('Volver a incidencias');
    expect(listReturnLabel('/tareas?mias=1')).toBe('Volver a tareas');
  });
});
