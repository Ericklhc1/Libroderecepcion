import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detailHrefWithListContext, listReturnLabel, operationalListHref, safeListReturnHref } from '@/lib/list-navigation';

describe('retorno al archivo sin alterar sus lectores ni controles', () => {
  it('conserva filtros y página de historial en la ficha nativa', () => {
    const list = operationalListHref('/historial', { q: 'archivo & cerrado', clase: 'entry', estado: 'CERRADO', pagina: '2', area: 'area-1' });
    const detail = new URL(detailHrefWithListContext('/libro/entry-1', list, 'registro-entry-entry-1'), 'https://aroh.invalid');
    expect(detail.pathname).toBe('/libro/entry-1');
    expect(detail.searchParams.get('desdeLista')).toBe(list + '#registro-entry-entry-1');
    expect(listReturnLabel(list)).toBe('Volver al historial');
  });
  it('rechaza destinos extraños y no convierte el retorno en acceso a datos', () => {
    expect(safeListReturnHref('/historial?pagina=2&token=privado&returnTo=https%3A%2F%2Fevil.example', '/libro')).toBe('/historial?pagina=2');
    expect(safeListReturnHref('/historial/exportar?todos=1', '/libro')).toBe('/libro');
    expect(safeListReturnHref('//evil.example/historial', '/libro')).toBe('/libro');
  });
  it('mantiene guardias, archivo de cerrados, informe y auditoría originales', () => {
    const page = readFileSync('src/app/(app)/historial/page.tsx', 'utf8');
    for (const source of ['await requirePageUser()', 'getBookItems(filters,user)', 'parseBookFilters(params, { pageSize: 50 })', 'housekeepingAuditVisibility(user)', 'await scheduleAuditVisibility(user)', 'auditFollowUpReadWhere(user)', "user.permissions.includes('audit.view')", "reportParams.set('vista', 'historial')", "operationalListHref('/historial', params)", 'scope={user.id}']) expect(page).toContain(source);
    expect(page).not.toContain('onlyOpen: true');
  });
});
