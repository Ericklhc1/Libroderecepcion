import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as React from 'react';
import { ListNavigation, ListReturnLink } from '@/components/operational/list-navigation';
import { listPositionKey, listReturnKey } from '@/lib/list-navigation';

const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  select: vi.fn(),
  traversal: { current: null as string | null },
}));
vi.mock('react', async original => {
  const actual = await original<typeof React>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => { lifecycle.effects.push(effect); },
    useState: (initial: unknown) => [initial, lifecycle.select],
    useRef: () => lifecycle.traversal,
  };
});

const href = '/libro?clase=task&pagina=2';
const scope = 'usuario-real';
const rowAnchor = 'registro-task-real';
const saved = { rowAnchor, scrollY: 1428 };
const historyKey = listPositionKey(scope, href) + ':history:current-entry';
let events: EventTarget;
let storage: Map<string, string>;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let cleanup: void | (() => void);
const focus = vi.fn();
const scrollTo = vi.fn();
const navigation = vi.fn();
const findRow = vi.fn();

function mount(listHref = href) {
  ListNavigation({ href: listHref, scope, children: null });
  cleanup = lifecycle.effects.shift()!();
}
function paint() {
  while (frames.size) {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, callback] of pending) callback(0);
  }
}
function pageShow(persisted: boolean) {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted });
  events.dispatchEvent(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  lifecycle.effects.length = 0;
  lifecycle.traversal.current = null;
  events = new EventTarget();
  storage = new Map([[listPositionKey(scope, href), JSON.stringify(saved)], [historyKey, JSON.stringify(saved)]]);
  frames = new Map(); frameId = 0; cleanup = undefined;
  vi.stubGlobal('window', {
    location: new URL(href, 'https://aroh.invalid'), scrollTo, scrollY: saved.scrollY,
    navigation: { currentEntry: { key: 'current-entry' } },
    history: { pushState: vi.fn(), replaceState: vi.fn(), back: vi.fn(), forward: vi.fn(), scrollRestoration: 'auto' },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  findRow.mockImplementation(id => id === rowAnchor ? { focus } : null);
  vi.stubGlobal('document', { getElementById: findRow });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  navigation.mockReturnValue([{ type: 'navigate', name: 'https://aroh.invalid' + href }]);
  vi.stubGlobal('performance', { getEntriesByType: navigation });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
});
afterEach(() => {
  cleanup?.();
  expect(window.history.pushState).not.toHaveBeenCalled();
  expect(window.history.replaceState).not.toHaveBeenCalled();
  expect(window.history.back).not.toHaveBeenCalled();
  expect(window.history.forward).not.toHaveBeenCalled();
  expect(window.history.scrollRestoration).toBe('auto');
  vi.unstubAllGlobals();
});

describe('restauración de presentación sin alterar el historial', () => {
  it('Back/Forward restaura el desplazamiento después del layout sin robar el foco', () => {
    navigation.mockReturnValue([{ type: 'back_forward', name: window.location.href }]);
    mount();
    expect(scrollTo).not.toHaveBeenCalled();
    paint();
    expect(scrollTo).toHaveBeenCalledWith({ top: saved.scrollY, behavior: 'instant' });
    expect(lifecycle.select).toHaveBeenLastCalledWith(rowAnchor);
    expect(focus).not.toHaveBeenCalled();
  });

  it('una página recuperada de bfcache lee la última fila aunque su fragmento sea anterior', () => {
    window.location.hash = '#registro-task-anterior';
    storage.set(listPositionKey(scope, href), JSON.stringify({ rowAnchor: 'registro-task-anterior', scrollY: 200 }));
    mount();
    storage.set(listPositionKey(scope, href), JSON.stringify(saved));
    pageShow(true); paint();
    expect(scrollTo).toHaveBeenCalledWith({ top: saved.scrollY, behavior: 'instant' });
    expect(lifecycle.select).toHaveBeenLastCalledWith(rowAnchor);
    expect(focus).not.toHaveBeenCalled();
  });

  it('dos visitas de la misma URL conservan su scroll propio al recorrer el historial', () => {
    navigation.mockReturnValue([{ type: 'back_forward', name: window.location.href }]);
    storage.set(listPositionKey(scope, href), JSON.stringify({ rowAnchor: 'registro-task-otro', scrollY: 2800 }));
    mount(); paint();
    expect(scrollTo).toHaveBeenCalledWith({ top: saved.scrollY, behavior: 'instant' });
    expect(lifecycle.select).toHaveBeenLastCalledWith('registro-task-otro');
  });

  it('no toma la posición de otra entrada si la entrada actual no tiene snapshot', () => {
    navigation.mockReturnValue([{ type: 'back_forward', name: window.location.href }]);
    storage.delete(historyKey);
    mount(); paint();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('popstate cliente usa la entrada de destino actual sin mover el foco', () => {
    mount();
    Object.defineProperty(window.navigation.currentEntry, 'key', { value: 'earlier-entry' });
    storage.set(listPositionKey(scope, href) + ':history:earlier-entry', JSON.stringify({ rowAnchor, scrollY: 732 }));
    events.dispatchEvent(new Event('popstate')); paint();
    expect(scrollTo).toHaveBeenCalledWith({ top: 732, behavior: 'instant' });
    expect(focus).not.toHaveBeenCalled();
  });

  it('popstate no desplaza otra lista mientras el router prepara los filtros de destino', () => {
    mount();
    const destination = '/libro?clase=task&pagina=1';
    window.location.search = '?clase=task&pagina=1';
    storage.set(listPositionKey(scope, destination), JSON.stringify(saved));
    storage.set(listPositionKey(scope, destination) + ':history:current-entry', JSON.stringify(saved));
    events.dispatchEvent(new Event('popstate')); paint();
    expect(scrollTo).not.toHaveBeenCalled();
    cleanup?.(); mount(destination); paint();
    expect(scrollTo).toHaveBeenCalledWith({ top: saved.scrollY, behavior: 'instant' });
  });

  it('guarda el scroll al salir, después de cualquier desplazamiento adicional', () => {
    mount();
    Object.defineProperty(window, 'scrollY', { value: 2017 });
    events.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(storage.get(historyKey)!)).toEqual({ rowAnchor, scrollY: 2017 });
    pageShow(true); paint();
    expect(scrollTo).toHaveBeenCalledWith({ top: 2017, behavior: 'instant' });
  });

  it('sin API de Navigation restaura sólo el snapshot del mismo documento en bfcache', () => {
    Object.defineProperty(window, 'navigation', { value: undefined });
    navigation.mockReturnValue([{ type: 'back_forward', name: window.location.href }]);
    mount(); paint();
    expect(scrollTo).not.toHaveBeenCalled();
    events.dispatchEvent(new Event('pagehide'));
    pageShow(true); paint();
    expect(scrollTo).toHaveBeenCalledWith({ top: saved.scrollY, behavior: 'instant' });
  });

  it('captura la entrada nativa al activar una fila sin modificar el historial', () => {
    const provider = ListNavigation({ href, scope, children: null });
    provider.props.value.remember(rowAnchor);
    expect(JSON.parse(storage.get(historyKey)!)).toEqual(saved);
  });

  it.each(['navigate', 'reload'])('no impone la posición guardada en una visita %s', type => {
    navigation.mockReturnValue([{ type, name: window.location.href }]);
    mount(); pageShow(false); paint();
    expect(lifecycle.select).toHaveBeenLastCalledWith(rowAnchor);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('no reaplica el indicador del documento original a una ruta cliente posterior', () => {
    navigation.mockReturnValue([{ type: 'back_forward', name: 'https://aroh.invalid/libro?clase=entry' }]);
    mount(); paint();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('el retorno explícito mantiene foco, posición y consumo de su marcador', () => {
    window.location.hash = '#' + rowAnchor;
    storage.set(listReturnKey(scope), href + '#' + rowAnchor);
    mount(); paint();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollTo).toHaveBeenCalledWith({ top: saved.scrollY, behavior: 'instant' });
    expect(storage.has(listReturnKey(scope))).toBe(false);
  });

  it('conserva el fragmento explícito si corresponde a otra fila que la guardada', () => {
    window.location.hash = '#registro-task-otro';
    storage.set(listReturnKey(scope), href + window.location.hash);
    findRow.mockReturnValue({ focus });
    mount(); paint();
    expect(lifecycle.select).toHaveBeenLastCalledWith('registro-task-otro');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('no restaura una posición si la fila ya no está en la respuesta autorizada', () => {
    navigation.mockReturnValue([{ type: 'back_forward', name: window.location.href }]);
    findRow.mockReturnValue(null);
    mount(); paint();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('sin almacenamiento ni entrada de navegación deja disponible el retorno nativo', () => {
    navigation.mockReturnValue([]);
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('Storage disabled'); } });
    window.location.hash = '#' + rowAnchor;
    mount(); pageShow(true); paint();
    expect(lifecycle.select).toHaveBeenLastCalledWith(rowAnchor);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('desmontar cancela frames y la escucha del historial de documentos', () => {
    navigation.mockReturnValue([{ type: 'back_forward', name: window.location.href }]);
    mount(); cleanup?.(); cleanup = undefined;
    paint(); pageShow(true); paint();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(lifecycle.select).not.toHaveBeenCalled();
  });

  it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey', 'middle'])('abrir un retorno con %s no marca la pestaña original', modifier => {
    const link = ListReturnLink({ href, scope });
    link.props.onClick({ button: modifier === 'middle' ? 1 : 0, [modifier]: true });
    expect(storage.has(listReturnKey(scope))).toBe(false);
  });
});
