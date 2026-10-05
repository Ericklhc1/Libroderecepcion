import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ task: vi.fn(), coordination: vi.fn(), assign: vi.fn(), reload: vi.fn(), replaceState: vi.fn(), fetch: vi.fn() }));
vi.mock('@/server/actions/tasks', () => ({ changeTaskStatusAction: calls.task }));
vi.mock('@/server/actions/coordination', () => ({ coordinateWorkAction: calls.coordination }));
import { changeTaskStatusFormAction } from '@/server/actions/operational-navigation';
import { requestSubjectAttentionAction, changeLostFoundAction, createLostFoundAction } from '@/components/operational/navigation-action';
import { detailHrefWithReturnContext } from '@/lib/list-navigation';

const origin = 'https://aroh.invalid';
const list = '/libro?q=ruido&clase=entry&pagina=2#registro-entry-origen';

function setCurrent(href: string) {
  const url = new URL(href, origin);
  vi.stubGlobal('window', {
    location: { origin, href: url.href, pathname: url.pathname, assign: calls.assign, reload: calls.reload },
    history: { state: { arohContextPanel: { rowAnchor: 'registro-custody-objeto-real' } }, replaceState: calls.replaceState },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', calls.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('retorno de lista después de acciones nativas', () => {
  it('el wrapper existente de tareas conserva desdeLista tras guardar sin alterar el formulario', async () => {
    calls.task.mockResolvedValue({ ok: true, message: 'Guardado' });
    const href = detailHrefWithReturnContext('/tareas/trabajo', list);
    const form = new FormData();
    form.set('id', 'trabajo'); form.set('status', 'ACEPTADA'); form.set('returnTo', href);
    expect((await changeTaskStatusFormAction(null, form)).navigateTo).toBe(href);
    expect(calls.task).toHaveBeenCalledExactlyOnceWith(null, form);
  });

  it('solicitar atención conserva el retorno sólo al volver al mismo asunto', async () => {
    setCurrent(detailHrefWithReturnContext('/libro/origen', list));
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, message: 'Solicitud guardada', navigateTo: '/libro/origen' })));
    const form = new FormData(); form.set('entryId', 'origen');
    const result = await requestSubjectAttentionAction(null, form);
    expect(result.ok).toBe(true);
    expect(calls.assign).toHaveBeenCalledExactlyOnceWith(origin + detailHrefWithReturnContext('/libro/origen', list));
    const sent = JSON.parse(calls.fetch.mock.calls[0]![1].body);
    expect(sent).toEqual({ entryId: 'origen' });
  });

  it('no propaga retorno a otra entidad o un destino distinto decidido por el servidor', async () => {
    setCurrent(detailHrefWithReturnContext('/libro/origen', list));
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, message: 'Guardado', navigateTo: '/libro/otra' })));
    await requestSubjectAttentionAction(null, new FormData());
    expect(calls.assign).toHaveBeenCalledExactlyOnceWith(origin + '/libro/otra');
  });

  it.each([
    '/libro/origen',
    `/libro/origen?desdeLista=${encodeURIComponent('//evil.invalid')}`,
    '/libro/origen?desdeLista=%2Flibro&desdeLista=%2Ftareas',
  ])('no inventa contexto ausente, ajeno o ambiguo: %s', async href => {
    setCurrent(href);
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, message: 'Guardado', navigateTo: '/libro/origen' })));
    await requestSubjectAttentionAction(null, new FormData());
    expect(calls.assign).toHaveBeenCalledExactlyOnceWith(origin + '/libro/origen');
  });

  it.each(['https://evil.invalid/libro/origen', '//evil.invalid/libro/origen', '/\\evil.invalid/libro/origen', 'javascript:alert(1)'])('rechaza un destino de respuesta externo: %s', async navigateTo => {
    setCurrent(detailHrefWithReturnContext('/libro/origen', list));
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, message: 'Guardado', navigateTo })));
    expect((await requestSubjectAttentionAction(null, new FormData())).ok).toBe(false);
    expect(calls.assign).not.toHaveBeenCalled();
  });

  it('custodia conserva sólo filtros vigentes y usa el resultado real como pista de foco', async () => {
    setCurrent('/custodia?estado=EN_CUSTODIA&q=llave&pagina=2&objeto=123&next=https%3A%2F%2Fevil.invalid');
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, id: 'objeto-real', message: 'Actualizado', navigateTo: '/custodia' })));
    await changeLostFoundAction(null, new FormData());
    expect(calls.assign).toHaveBeenCalledExactlyOnceWith(origin + '/custodia?estado=EN_CUSTODIA&q=llave&pagina=2#registro-custody-objeto-real');
    expect(calls.reload).not.toHaveBeenCalled();
    expect(calls.replaceState).not.toHaveBeenCalled();
  });

  it.each(['MOVER', 'ENTREGAR', 'DISPONER', 'REABRIR'])('reconsulta el documento tras %s cuando el panel ya usa el mismo fragmento', async action => {
    const href = '/custodia?estado=EN_CUSTODIA&q=llave&pagina=2#registro-custody-objeto-real';
    setCurrent(href);
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, id: 'objeto-real', message: 'Actualizado', navigateTo: '/custodia' })));
    const form = new FormData();
    form.set('id', 'objeto-real'); form.set('version', '7'); form.set('action', action);
    expect((await changeLostFoundAction(null, form)).ok).toBe(true);
    expect(calls.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', origin + href);
    expect(calls.reload).toHaveBeenCalledExactlyOnceWith();
    expect(calls.assign).not.toHaveBeenCalled();
    expect(calls.replaceState.mock.invocationCallOrder[0]).toBeLessThan(calls.reload.mock.invocationCallOrder[0]!);
    expect(JSON.parse(calls.fetch.mock.calls[0]![1].body)).toEqual({ id: 'objeto-real', version: '7', action });
  });

  it.each(['', '#objeto-123', '#registro-custody-otro'])('reconsulta también si sólo cambia el fragmento anterior: %s', async fragment => {
    setCurrent('/custodia?q=llave&pagina=2' + fragment);
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, id: 'objeto-real', message: 'Actualizado', navigateTo: '/custodia' })));
    await changeLostFoundAction(null, new FormData());
    expect(calls.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', origin + '/custodia?q=llave&pagina=2#registro-custody-objeto-real');
    expect(calls.reload).toHaveBeenCalledExactlyOnceWith();
    expect(calls.assign).not.toHaveBeenCalled();
  });

  it('un rechazo de custodia conserva el panel y el documento actuales', async () => {
    setCurrent('/custodia?q=llave#registro-custody-objeto-real');
    const rejection = { ok: false, error: 'El registro cambió. Actualiza antes de continuar.' };
    calls.fetch.mockResolvedValue(new Response(JSON.stringify(rejection), { status: 400 }));
    expect(await changeLostFoundAction(null, new FormData())).toEqual(rejection);
    expect(calls.assign).not.toHaveBeenCalled();
    expect(calls.reload).not.toHaveBeenCalled();
    expect(calls.replaceState).not.toHaveBeenCalled();
  });

  it('registrar custodia no reabre una selección anterior ni acepta filtros repetidos', async () => {
    setCurrent('/custodia?q=uno&q=dos&pagina=3&objeto=123');
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, id: 'nuevo', message: 'Registrado', navigateTo: '/custodia' })));
    await createLostFoundAction(null, new FormData());
    expect(calls.assign).toHaveBeenCalledExactlyOnceWith(origin + '/custodia?pagina=3');
  });

  it('no transmite contexto de custodia desde otra ruta ni altera el destino nativo', async () => {
    setCurrent('/libro?q=privado');
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, id: 'objeto-real', message: 'Actualizado', navigateTo: '/custodia' })));
    await changeLostFoundAction(null, new FormData());
    expect(calls.assign).toHaveBeenCalledExactlyOnceWith(origin + '/custodia');
  });

  it('no navega si la acción nativa rechaza permisos o datos', async () => {
    setCurrent(detailHrefWithReturnContext('/libro/origen', list));
    calls.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 403 }));
    expect(await requestSubjectAttentionAction(null, new FormData())).toEqual({ ok: false, error: 'No autorizado' });
    expect(calls.assign).not.toHaveBeenCalled();
  });
});
