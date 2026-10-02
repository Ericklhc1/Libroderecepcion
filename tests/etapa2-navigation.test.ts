import { describe, expect, it, vi, beforeEach } from 'vitest';
const calls = vi.hoisted(() => ({ coordination: vi.fn(), task: vi.fn(), redirect: vi.fn((url: string) => { throw new Error('REDIRECT:' + url); }) }));
vi.mock('next/navigation', () => ({ redirect: calls.redirect }));
vi.mock('@/server/actions/coordination', () => ({ coordinateWorkAction: calls.coordination }));
vi.mock('@/server/actions/tasks', () => ({ changeTaskStatusAction: calls.task }));
import { coordinateWorkFormAction, changeTaskStatusFormAction } from '@/server/actions/operational-navigation';
beforeEach(() => { vi.clearAllMocks(); });
describe('Navegación posterior a operaciones nativas', () => {
  it('mantiene datos, permisos y resultado nativo; navega después del éxito conservando filtros', async () => {
    calls.coordination.mockResolvedValue({ ok: true, message: 'Asignado' });
    const form = new FormData(); form.set('returnTo', '/coordinacion?area=sintetica&mios=1'); form.set('ownerId', 'persona');
    await expect(coordinateWorkFormAction(null, form)).rejects.toThrow('REDIRECT:/coordinacion?area=sintetica&mios=1');
    expect(calls.coordination).toHaveBeenCalledExactlyOnceWith(null, form);
  });
  it('no navega ni oculta un rechazo nativo', async () => {
    const result = { ok: false, error: 'No autorizado', fieldErrors: { ownerId: ['Revisa responsable'] } };
    calls.coordination.mockResolvedValue(result);
    expect(await coordinateWorkFormAction(null, new FormData())).toEqual(result);
    expect(calls.redirect).not.toHaveBeenCalled();
  });
  it('rechaza destinos externos, rutas distintas y escape con barra inversa', async () => {
    calls.task.mockResolvedValue({ ok: true, message: 'Resuelto' });
    for (const target of ['https://example.com', '//example.com', '/\\example.com', '/admin', '/tareas/../../admin']) {
      const form = new FormData(); form.set('returnTo', target);
      await expect(changeTaskStatusFormAction(null, form)).rejects.toThrow('REDIRECT:/tareas');
    }
    expect(calls.task).toHaveBeenCalledTimes(5);
  });
});
