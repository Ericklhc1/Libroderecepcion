import { readFileSync } from 'node:fs';
import Link from 'next/link';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextWorklist } from '@/components/operational/context-worklist';
import { readWorklistPanelPosition, WORKLIST_HISTORY_KEY } from '@/lib/worklist-context';
import { detailHrefWithListContext, listReturnLabel, operationalListHref, safeListReturnHref, sameOperationalList } from '@/lib/list-navigation';

const href = '/coordinacion?area=mantenimiento&vista=unreceived&mios=1&pagina=2';
const scope = 'usuario-real';
const id = 'registro-task-trabajo-real';
const marker = { [WORKLIST_HISTORY_KEY]: { href, scope, rowAnchor: id, scrollY: 824 } };

describe('bandeja contextual sin un motor operativo nuevo', () => {
  it('valida el historial por usuario, lista exacta y fila ya autorizada', () => {
    expect(readWorklistPanelPosition(marker, href, scope, [id])).toEqual(marker[WORKLIST_HISTORY_KEY]);
    expect(readWorklistPanelPosition(marker, href, 'otra-persona', [id])).toBeNull();
    expect(readWorklistPanelPosition(marker, href + '&q=otro', scope, [id])).toBeNull();
    expect(readWorklistPanelPosition(marker, href, scope, ['registro-task-otro'])).toBeNull();
    expect(readWorklistPanelPosition({ ...marker, next: '/admin' }, href, scope, [id])).toEqual(marker[WORKLIST_HISTORY_KEY]);
  });

  it.each([null, undefined, '', {}, { [WORKLIST_HISTORY_KEY]: null },
    { [WORKLIST_HISTORY_KEY]: { ...marker[WORKLIST_HISTORY_KEY], rowAnchor: 'no-canónico' } },
    { [WORKLIST_HISTORY_KEY]: { ...marker[WORKLIST_HISTORY_KEY], scrollY: -1 } },
    { [WORKLIST_HISTORY_KEY]: { ...marker[WORKLIST_HISTORY_KEY], scrollY: 10_000_001 } },
    { [WORKLIST_HISTORY_KEY]: { ...marker[WORKLIST_HISTORY_KEY], scrollY: '100' } },
    { [WORKLIST_HISTORY_KEY]: { ...marker[WORKLIST_HISTORY_KEY], scrollY: BigInt(100) } },
  ])('ignora un marcador de presentación inválido: %#', state => {
    expect(readWorklistPanelPosition(state, href, scope, [id])).toBeNull();
  });

  it('conserva los filtros nativos de Coordinación y el ancla al abrir tarea u origen', () => {
    const list = operationalListHref('/coordinacion', {
      area: 'mantenimiento', vista: 'blocked', mios: '1', pagina: '3', historial: '1',
      q: 'habitación #512', estado: 'bloqueado', responsable: 'operador', fecha: '2026-10-05',
      desdeLista: '//evil.invalid', action: 'ASIGNAR', clase: 'task', mias: '1',
    });
    const query = new URL(list, 'https://aroh.invalid').searchParams;
    expect([...query.keys()].sort()).toEqual(['area', 'estado', 'fecha', 'historial', 'mios', 'pagina', 'q', 'responsable', 'vista']);
    expect(query.get('mios')).toBe('1');
    expect(query.get('fecha')).toBe('2026-10-05');
    for (const native of ['/tareas/trabajo-real', '/libro/origen-real']) {
      const target = new URL(detailHrefWithListContext(native, list, id), 'https://aroh.invalid');
      expect(target.pathname).toBe(native);
      expect(safeListReturnHref(target.searchParams.get('desdeLista'), '/libro')).toBe(`${list}#${id}`);
    }
    expect(listReturnLabel(list)).toBe('Volver a coordinación');
    expect(safeListReturnHref('/coordinacion/automatizaciones?area=mantenimiento', '/libro')).toBe('/libro');
    expect(safeListReturnHref('/coordinacion/../admin?area=mantenimiento', '/libro')).toBe('/libro');
    expect(safeListReturnHref('/coordinacion?q=uno&q=dos&redirect=https://evil.invalid#inventado', '/libro')).toBe('/coordinacion?q=uno');
  });

  it('Housekeeping admite sólo sus filtros vigentes y el ID de ancla del trabajo', () => {
    const list = operationalListHref('/admin/housekeeping', { vista: 'mios', fecha: '2026-10-05', area: 'hk', piso: '5', responsable: 'persona', pagina: '2', aviso: '512', q: 'ropa', estado: 'RECIBIDO', next: '/admin', historial: '1', mios: '1' });
    expect(new URL(list, 'https://aroh.invalid').searchParams.size).toBe(9);
    expect(safeListReturnHref(`${list}#registro-housekeeping-real`, '/libro')).toBe(`${list}#registro-housekeeping-real`);
    expect(listReturnLabel(list)).toBe('Volver a Housekeeping');
    expect(safeListReturnHref('/admin/housekeeping/otro', '/libro')).toBe('/libro');
    expect(safeListReturnHref('/libro?mios=1&vista=blocked&fecha=2026-10-05&tipo=INCIDENCIA', '/libro')).toBe('/libro?tipo=INCIDENCIA');
  });

  it('el contexto de habitación conserva sólo habitación y piso sin aceptar rutas PMS', () => {
    const list = operationalListHref('/novedades/habitacion', { habitacion: '512', piso: '5', reserva: 'ajena', q: 'omitida', pagina: '2', next: '/admin' });
    expect(list).toBe('/novedades/habitacion?habitacion=512&piso=5');
    const native = new URL(detailHrefWithListContext('/libro/origen-real', list, 'registro-room-room-real'), 'https://aroh.invalid');
    expect(safeListReturnHref(native.searchParams.get('desdeLista'), '/libro')).toBe(list + '#registro-room-room-real');
    expect(listReturnLabel(list)).toBe('Volver al contexto de habitación');
    expect(safeListReturnHref('/novedades/habitacion/reservas', '/libro')).toBe('/libro');
    expect(safeListReturnHref('/reservas?habitacion=512', '/libro')).toBe('/libro');
  });

  it('renderiza el contexto nativo sin JS y una sola copia de formularios antes de hidratar', () => {
    const html = renderToStaticMarkup(<ContextWorklist href={href} scope={scope} label="Trabajo pendiente" rows={[{
      id, title: 'Asunto #512 · Revisar equipo', href: '/tareas/trabajo-real',
      summary: <p>Responsable real · Siguiente acción canónica</p>,
      children: <><Link href="/libro/origen-real">Origen real</Link><form><input name="updatedAt" value="revision-real" readOnly /><input name="requestKey" value="request-real" readOnly /></form></>,
    }]} />);
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('href="/tareas/trabajo-real?desdeLista=');
    expect(html).toContain('Abrir ficha completa');
    expect(html).toContain('Responsable real · Siguiente acción canónica');
    expect(html).not.toContain('role="dialog"');
    const start = html.indexOf('<details');
    const end = html.indexOf('</details>');
    expect(start).toBeGreaterThan(-1);
    expect(html).not.toContain('<noscript>');
    expect(html.slice(start, end)).toContain('data-worklist-fallback');
    expect(html.indexOf('<form>')).toBeGreaterThan(start);
    expect(html.indexOf('</form>')).toBeLessThan(end);
    expect(html.match(/<form>/g)).toHaveLength(1);
    expect(html.slice(start, end)).toContain('Origen real');
  });

  it('un enlace profundo abre sólo el contexto presente en la respuesta de servidor', () => {
    const render = (initialOpenId: string) => renderToStaticMarkup(<ContextWorklist href="/admin/housekeeping?aviso=512" scope={scope} label="Avisos" initialOpenId={initialOpenId} rows={[{ id: 'registro-housekeeping-real', title: 'Aviso #512', href: '/admin/housekeeping?aviso=512', summary: 'Aviso real', children: 'Detalle autorizado' }]} />);
    expect(render('registro-housekeeping-real')).toContain('<details open=""');
    expect(render('registro-housekeeping-ajeno')).not.toContain('<details open=""');
    expect(render('registro-housekeeping-ajeno')).not.toContain('Detalle ajeno');
  });

  it('la primitive reutiliza el diálogo y no incorpora servicios, consultas ni mutaciones', () => {
    const component = readFileSync('src/components/operational/context-worklist.tsx', 'utf8');
    const dialog = readFileSync('src/components/ui/dialog.tsx', 'utf8');
    expect(component).toContain('presentation="side-panel"');
    expect(component).not.toContain('@/server/');
    expect(component).not.toContain('fetch(');
    expect(component).toContain('window.history.pushState({ [WORKLIST_HISTORY_KEY]');
    expect(component).toContain("window.addEventListener('popstate'");
    expect(component).toContain('event.metaKey || event.ctrlKey || event.altKey || event.shiftKey');
    expect(component).toContain('{!hydrated && <details');
    expect(dialog).toContain("presentation = 'centered'");
    expect(dialog).toContain('lockBodyScroll()');
    expect(dialog).toContain('if (activeDialogs.at(-1) !== id) return;');
    expect(dialog).toContain('active === panelRef.current');
  });
});


describe('identidad de la lista solicitada', () => {
  it('normaliza orden, filtros vacíos y campos ajenos sin inventar defaults', () => {
    expect(sameOperationalList('/admin/housekeeping?area=hsk&vista=&q=limpieza', '/admin/housekeeping?q=limpieza&area=hsk')).toBe(true);
    expect(sameOperationalList('/coordinacion?extra=1', '/coordinacion')).toBe(true);
    expect(sameOperationalList('/coordinacion?pagina=2', '/coordinacion')).toBe(false);
    expect(sameOperationalList('/custodia?q=A', '/custodia?q=B')).toBe(false);
    expect(sameOperationalList('/api/coordinacion', '/coordinacion')).toBe(false);
    expect(sameOperationalList('https://evil.example/coordinacion', '/coordinacion')).toBe(false);
  });
  it('no usa filtros añadidos del tablero como identidad de la URL original', () => {
    const coordination = readFileSync('src/app/(app)/coordinacion/page.tsx', 'utf8');
    const housekeeping = readFileSync('src/app/(app)/admin/housekeeping/page.tsx', 'utf8');
    expect(coordination).toContain("const listHref=operationalListHref('/coordinacion',p)");
    expect(housekeeping).toContain("const currentListHref = operationalListHref('/admin/housekeeping', params)");
    expect(housekeeping).toContain("href: operationalListHref('/admin/housekeeping', { ...params, pagina: '1', aviso: String(r.humanId) })");
  });
});
