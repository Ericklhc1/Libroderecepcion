import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { operationalListHref, safeListReturnHref } from '@/lib/list-navigation';

const calls = vi.hoisted(() => ({ user: vi.fn(), list: vi.fn(), team: vi.fn() }));
vi.mock('@/server/auth/guard', () => ({ requirePageUser: calls.user }));
vi.mock('@/server/services/lost-found', () => ({ listLostFound: calls.list, lostFoundTeam: calls.team }));
vi.mock('@/components/operational/lost-found-forms', () => ({
  NewLostFoundForm: ({ requestKey }: { requestKey: string }) => <button data-create-key={requestKey}>Registrar objeto</button>,
  LostFoundAction: ({ id, version, action, currentLocation, currentCustodian }: { id: string; version: number; action: string; currentLocation: string; currentCustodian?: string | null }) => <button data-native-id={id} data-native-version={version} data-native-action={action} data-native-location={currentLocation} data-native-custodian={currentCustodian}>{action}</button>,
}));
import CustodiaPage from '@/app/(app)/custodia/page';

const reader = { id: 'lector-real', roleKey: 'GERENCIA', permissions: ['custody.view'] };
const original = {
  id: 'objeto-real', humanId: 512, version: 7, status: 'EN_CUSTODIA', item: 'Mochila azul',
  foundAt: new Date('2026-10-04T15:00:00Z'), foundLocation: 'Hallazgo real', custodyLocation: 'Gabinete real',
  registeredBy: { name: 'Persona que registró' }, custodianId: 'custodio-real', custodian: { name: 'Custodio real' },
  finalAction: null as string | null, evidenceNote: null as string | null, closedBy: null as { name: string } | null, closedAt: null as Date | null,
  events: [{ id: 'evento-real', actorName: 'Autor histórico', createdAt: new Date('2026-10-04T15:00:00Z'), action: 'REGISTRAR', note: 'Referencia histórica original' }],
};
async function render(params: { estado?: string; q?: string; pagina?: string; objeto?: string } = {}) {
  return renderToStaticMarkup(await CustodiaPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.user.mockResolvedValue(reader);
  calls.list.mockResolvedValue([original]);
  calls.team.mockResolvedValue([{ id: 'custodio-real', name: 'Custodio real' }]);
});

describe('Custodia contextual conserva lectura, permisos y autoridad nativa', () => {
  it('consulta el lector original con los filtros y mantiene el folio y el ancla histórica', async () => {
    const html = await render({ estado: 'EN_CUSTODIA', q: 'Mochila', pagina: '2' });
    expect(calls.user).toHaveBeenCalledExactlyOnceWith({ allowAreaOperation: true });
    expect(calls.list).toHaveBeenCalledExactlyOnceWith(reader, { status: 'EN_CUSTODIA', q: 'Mochila', page: 2 });
    expect(calls.team).not.toHaveBeenCalled();
    expect(html).toContain('id="registro-custody-objeto-real"');
    expect(html).toContain('id="objeto-512"');
    expect(html).toContain('href="/custodia?estado=EN_CUSTODIA&amp;q=Mochila&amp;pagina=2&amp;objeto=512"');
    expect(html).toContain('href="/custodia?estado=EN_CUSTODIA&amp;q=Mochila&amp;pagina=1"');
    expect(html).toContain('Página 2');
    expect(html).toContain('1 registros visibles con estos filtros');
  });

  it('un lector ve datos e historial, sin catálogo de responsables ni controles de escritura', async () => {
    const html = await render();
    for (const text of ['Hallazgo real', 'Gabinete real', 'Persona que registró', 'Custodio real', 'Autor histórico', 'Referencia histórica original']) expect(html).toContain(text);
    expect(html).toContain('Tu acceso permite revisar el registro y su historial');
    expect(html).not.toContain('data-native-action');
    expect(html).not.toContain('data-create-key');
    expect(calls.team).not.toHaveBeenCalled();
  });

  it.each([
    { ...reader, roleKey: 'ADMINISTRADOR_SISTEMA', permissions: [] },
    { ...reader, roleKey: 'ROL_CONCEDIDO', permissions: ['custody.manage'] },
  ])('usa privilegio nativo de administrador o permiso concedido, con ID y versión originales', async user => {
    calls.user.mockResolvedValue(user);
    const html = await render();
    expect(calls.team).toHaveBeenCalledExactlyOnceWith(user);
    expect(html).toContain('data-create-key');
    for (const action of ['MOVER', 'ENTREGAR', 'DISPONER']) expect(html).toContain(`data-native-action="${action}"`);
    expect(html.match(/data-native-id="objeto-real"/g)).toHaveLength(3);
    expect(html.match(/data-native-version="7"/g)).toHaveLength(3);
    expect(html).toContain('data-native-location="Gabinete real"');
    expect(html).toContain('data-native-custodian="custodio-real"');
    expect(html).not.toContain('data-native-action="REABRIR"');
  });

  it.each(['ENTREGADO', 'DISPUESTO'])('conserva cierre, evidencia, autor e historial de %s y sólo ofrece reapertura', async status => {
    calls.user.mockResolvedValue({ ...reader, permissions: ['custody.manage'] });
    calls.list.mockResolvedValue([{ ...original, status, finalAction: 'Resultado original', evidenceNote: 'Acta original 42', closedBy: { name: 'Autor del cierre' }, closedAt: new Date('2026-10-04T16:00:00Z') }]);
    const html = await render();
    for (const text of ['Resultado original', 'Acta original 42', 'Autor del cierre', 'Autor histórico', 'Referencia histórica original']) expect(html).toContain(text);
    expect(html).toContain('data-native-action="REABRIR"');
    expect(html).not.toContain('data-native-action="MOVER"');
    expect(html).not.toContain('data-native-action="ENTREGAR"');
    expect(html).not.toContain('data-native-action="DISPONER"');
  });

  it('abre un enlace profundo sólo si el folio ya está en la página autorizada, también sin JS', async () => {
    const html = await render({ objeto: '512' });
    const fallback = html.match(/<details\b[^>]*data-worklist-fallback[^>]*>[\s\S]*?<\/details>/)?.[0];
    expect(fallback).toBeDefined();
    expect(fallback).toContain('<details open=""');
    expect(fallback).toContain('Hallazgo real');
    expect(html).not.toContain('<noscript>');
    expect(await render({ objeto: '999999' })).not.toContain('<details open=""');
    expect(calls.list.mock.calls.every(([, filters]) => !('humanId' in filters))).toBe(true);
  });

  it('no convierte consulta vacía o rechazo del lector nativo en otro resultado', async () => {
    calls.list.mockResolvedValue([]);
    const html = await render({ objeto: '512', estado: 'ENTREGADO' });
    expect(html).toContain('No hay objetos con estos filtros');
    expect(html).not.toContain('data-worklist-row');
    expect(html).not.toContain('data-custody-detail');
    calls.list.mockRejectedValueOnce(new Error('Sin permiso de custodia'));
    await expect(render()).rejects.toThrow('Sin permiso de custodia');
  });

  it('conserva paginación de 50 y limpia selección al cambiar página', async () => {
    calls.list.mockResolvedValue(Array.from({ length: 50 }, (_, index) => ({ ...original, id: `objeto-${index}`, humanId: 512 + index })));
    const html = await render({ estado: 'EN_CUSTODIA', q: 'Mochila', pagina: '2', objeto: '512' });
    expect(html).toContain('href="/custodia?estado=EN_CUSTODIA&amp;q=Mochila&amp;pagina=3"');
    expect(html).toContain('50 registros visibles con estos filtros');
  });

  it('filtra contexto de navegación a parámetros nativos de custodia sin abrir otras rutas', () => {
    const href = operationalListHref('/custodia', { estado: 'EN_CUSTODIA', q: '#512', pagina: '2', objeto: '512', next: 'https://evil.invalid', action: 'ENTREGAR', evidencia: 'ajena' });
    expect(href).toBe('/custodia?estado=EN_CUSTODIA&q=%23512&pagina=2&objeto=512');
    expect(safeListReturnHref(href + '#registro-custody-objeto-real', '/libro')).toBe(href + '#registro-custody-objeto-real');
    expect(safeListReturnHref('/custodia/borrar?objeto=512', '/libro')).toBe('/libro');
  });

  it('reutiliza los formularios originales con evidencia y control de revisión', () => {
    const forms = readFileSync('src/components/operational/lost-found-forms.tsx', 'utf8');
    const page = readFileSync('src/app/(app)/custodia/page.tsx', 'utf8');
    expect(forms).toContain("from '@/components/operational/navigation-action'");
    expect(forms).toContain('name="version" value={version}');
    expect(forms).toContain('name="evidenceNote" required');
    expect(forms).toContain('name="note" required');
    expect(page).toContain('<NewLostFoundForm');
    expect(page).toContain('<LostFoundAction');
    expect(page).not.toContain('fetch(');
    expect(page).not.toContain('Confirmar recepción');
  });
});
