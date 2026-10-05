import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShiftStartAction } from '@/components/operational/shift-start-navigation';
import type { ActionState } from '@/server/action';

const success = { ok: true, id: 'synthetic-handover', message: 'Preparado' } as const;
const rejected = { ok: false, error: 'Revisa el turno.', fieldErrors: { type: ['No permitido'] } } as const;
let documentEvents: EventTarget;
let windowEvents: EventTarget;
let navigationEvents: EventTarget & { currentEntry: { key: string } };
let location: URL;
const navigate = vi.fn();

class LinkTarget {
  target = '';
  download = false;
  constructor(public href: string) {}
  closest() { return this; }
  hasAttribute(name: string) { return name === 'download' && this.download; }
}
function click(href: string, options: { ctrlKey?: boolean; target?: string; download?: boolean } = {}) {
  const link = new LinkTarget(href);
  link.target = options.target ?? '';
  link.download = options.download ?? false;
  const event = new Event('click');
  Object.defineProperties(event, {
    target: { value: link }, button: { value: 0 }, ctrlKey: { value: options.ctrlKey ?? false },
  });
  documentEvents.dispatchEvent(event);
}
function deferred() {
  let resolve!: (value: ActionState) => void;
  const promise = new Promise<ActionState>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  documentEvents = new EventTarget();
  windowEvents = new EventTarget();
  navigationEvents = Object.assign(new EventTarget(), { currentEntry: { key: 'original-entry' } });
  location = new URL('https://aroh.invalid/turno');
  vi.stubGlobal('Element', LinkTarget);
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('window', Object.assign(windowEvents, { location, navigation: navigationEvents }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('avance acotado al iniciar entrega o recepción', () => {
  it.each([
    ['handover', '/turno/entrega/synthetic-handover?paso=1'],
    ['reception', '/turno/entrega/synthetic-handover'],
  ] as const)('avanza %s sólo después del resultado explícito y no altera campos', async (mode, href) => {
    const pending = deferred();
    const action = vi.fn().mockReturnValue(pending.promise);
    const adapted = createShiftStartAction(action, mode, navigate);
    const form = new FormData(); form.set('shiftId', 'synthetic');
    const result = adapted(null, form);
    await Promise.resolve();
    expect(action).toHaveBeenCalledExactlyOnceWith(null, form);
    expect(navigate).not.toHaveBeenCalled();
    pending.resolve(success);
    expect(await result).toBe(success);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(href);
  });

  it('coalesca el doble envío simultáneo y el segundo envío ya encolado', async () => {
    const pending = deferred();
    const action = vi.fn().mockReturnValue(pending.promise);
    const adapted = createShiftStartAction(action, 'handover', navigate);
    const first = adapted(null, new FormData());
    const second = adapted(null, new FormData());
    expect(second).toBe(first);
    pending.resolve(success);
    expect(await first).toBe(success);
    expect(await adapted(success, new FormData())).toBe(success);
    expect(action).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('devuelve errores y campos originales; permite corregir y reintentar', async () => {
    const error: ActionState = { ...rejected, fieldErrors: { type: ['No permitido'] } };
    const action = vi.fn().mockResolvedValueOnce(error).mockResolvedValueOnce(success);
    const adapted = createShiftStartAction(action, 'reception', navigate);
    expect(await adapted(null, new FormData())).toBe(error);
    expect(navigate).not.toHaveBeenCalled();
    expect(await adapted(error, new FormData())).toBe(success);
    expect(action).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('no inventa un destino ni repite una acción ya exitosa sin ID', async () => {
    const value = { ok: true, message: 'Guardado' } as const;
    const action = vi.fn().mockResolvedValue(value);
    const adapted = createShiftStartAction(action, 'handover', navigate);
    expect(await adapted(null, new FormData())).toBe(value);
    expect(await adapted(value, new FormData())).toBe(value);
    expect(navigate).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('libera la espera si la acción arroja una excepción síncrona', async () => {
    const action = vi.fn().mockImplementationOnce(() => { throw new Error('Sin respuesta'); }).mockResolvedValueOnce(success);
    const adapted = createShiftStartAction(action, 'handover', navigate);
    await expect(adapted(null, new FormData())).rejects.toThrow('Sin respuesta');
    expect(navigate).not.toHaveBeenCalled();
    expect(await adapted(null, new FormData())).toBe(success);
  });

  it.each(['popstate', 'hashchange', 'pagehide'])('no arrastra al usuario tras %s mientras espera', async event => {
    const pending = deferred();
    const adapted = createShiftStartAction(() => pending.promise, 'handover', navigate);
    const result = adapted(null, new FormData());
    windowEvents.dispatchEvent(new Event(event));
    pending.resolve(success); await result;
    expect(navigate).not.toHaveBeenCalled();
  });

  it('respeta un enlace nuevo incluso antes de que cambie la URL de una transición lenta', async () => {
    const pending = deferred();
    const result = createShiftStartAction(() => pending.promise, 'handover', navigate)(null, new FormData());
    click('https://aroh.invalid/coordinacion');
    expect(location.pathname).toBe('/turno');
    pending.resolve(success); await result;
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { target: '_blank' }, { download: true }])('otro contexto no cancela el avance de esta pestaña: %j', async options => {
    const pending = deferred();
    const result = createShiftStartAction(() => pending.promise, 'handover', navigate)(null, new FormData());
    click('https://aroh.invalid/coordinacion', options);
    pending.resolve(success); await result;
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('no avanza si la URL cambió sin eventos ni Navigation API', async () => {
    Object.assign(window, { navigation: undefined });
    const pending = deferred();
    const result = createShiftStartAction(() => pending.promise, 'handover', navigate)(null, new FormData());
    location.pathname = '/coordinacion';
    pending.resolve(success); await result;
    expect(navigate).not.toHaveBeenCalled();
  });

  it('no vuelve a apropiarse de una visita que salió y regresó', async () => {
    const pending = deferred();
    const result = createShiftStartAction(() => pending.promise, 'handover', navigate)(null, new FormData());
    const event = new Event('navigate');
    Object.defineProperty(event, 'destination', { value: { url: 'https://aroh.invalid/coordinacion' } });
    navigationEvents.dispatchEvent(event);
    location.pathname = '/coordinacion'; navigationEvents.currentEntry.key = 'new-entry';
    navigationEvents.dispatchEvent(new Event('currententrychange'));
    location.pathname = '/turno'; navigationEvents.currentEntry.key = 'original-entry';
    pending.resolve(success); await result;
    expect(navigate).not.toHaveBeenCalled();
  });

  it('la revalidación de la misma URL/entrada no cancela el avance', async () => {
    const pending = deferred();
    const result = createShiftStartAction(() => pending.promise, 'handover', navigate)(null, new FormData());
    navigationEvents.dispatchEvent(new Event('currententrychange'));
    pending.resolve(success); await result;
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('otra entrada de historial con la misma URL no recibe un callback antiguo', async () => {
    const pending = deferred();
    const result = createShiftStartAction(() => pending.promise, 'handover', navigate)(null, new FormData());
    navigationEvents.currentEntry.key = 'new-visit-same-url';
    pending.resolve(success); await result;
    expect(navigate).not.toHaveBeenCalled();
  });

  it('limpia todos los listeners tras error y admite un envío válido posterior', async () => {
    const addDocument = vi.spyOn(documentEvents, 'addEventListener');
    const removeDocument = vi.spyOn(documentEvents, 'removeEventListener');
    const addWindow = vi.spyOn(windowEvents, 'addEventListener');
    const removeWindow = vi.spyOn(windowEvents, 'removeEventListener');
    const addNavigation = vi.spyOn(navigationEvents, 'addEventListener');
    const removeNavigation = vi.spyOn(navigationEvents, 'removeEventListener');
    const action = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Revisa los datos.' }).mockResolvedValueOnce(success);
    const adapted = createShiftStartAction(action, 'handover', navigate);
    await adapted(null, new FormData());
    expect(removeDocument.mock.calls).toEqual(addDocument.mock.calls);
    expect(removeWindow.mock.calls).toEqual(addWindow.mock.calls);
    expect(removeNavigation.mock.calls).toEqual(addNavigation.mock.calls);
    click('https://aroh.invalid/coordinacion');
    expect(await adapted(null, new FormData())).toBe(success);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(removeDocument.mock.calls).toEqual(addDocument.mock.calls);
    expect(removeWindow.mock.calls).toEqual(addWindow.mock.calls);
    expect(removeNavigation.mock.calls).toEqual(addNavigation.mock.calls);
  });

  it('también conserva el inicio desde Inicio y limpia sus listeners al terminar', async () => {
    location.pathname = '/';
    const removeDocument = vi.spyOn(documentEvents, 'removeEventListener');
    const removeWindow = vi.spyOn(windowEvents, 'removeEventListener');
    const removeNavigation = vi.spyOn(navigationEvents, 'removeEventListener');
    const result = await createShiftStartAction(async () => success, 'handover', navigate)(null, new FormData());
    expect(result).toBe(success);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(removeDocument).toHaveBeenCalledWith('click', expect.any(Function), true);
    expect(removeDocument).toHaveBeenCalledTimes(1);
    expect(removeWindow).toHaveBeenCalledWith('popstate', expect.any(Function));
    expect(removeNavigation).toHaveBeenCalledWith('navigate', expect.any(Function));
  });
});
