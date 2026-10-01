import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>>, dispatch: vi.fn(), after: vi.fn() }));
vi.mock('next/server', () => ({ after: state.after }));
vi.mock('@/server/services/web-push', () => ({ dispatchWebPushForUsers: state.dispatch }));
import { scheduleWebPushForUsers } from '@/server/services/web-push-scheduler';

describe('push independiente por solicitud', () => {
  beforeEach(() => {
    state.callbacks = []; state.dispatch.mockReset(); state.after.mockReset();
    state.after.mockImplementation(callback => state.callbacks.push(callback));
  });
  it('no pierde el destinatario si la segunda solicitud termina primero', async () => {
    scheduleWebPushForUsers(['ana', 'ana', '']);
    scheduleWebPushForUsers(['erick']);
    expect(state.callbacks).toHaveLength(2);
    await state.callbacks[1]!();
    expect(state.dispatch).toHaveBeenLastCalledWith(['erick']);
    await state.callbacks[0]!();
    expect(state.dispatch).toHaveBeenLastCalledWith(['ana']);
  });
  it('no contamina la siguiente solicitud cuando after no tiene contexto', async () => {
    state.after.mockImplementationOnce(() => { throw new Error('no request'); });
    expect(() => scheduleWebPushForUsers(['ana'])).not.toThrow();
    scheduleWebPushForUsers(['erick']);
    await state.callbacks[0]!();
    expect(state.dispatch).toHaveBeenCalledExactlyOnceWith(['erick']);
  });
  it('no programa trabajo sin destinatarios', () => {
    scheduleWebPushForUsers(['']); expect(state.after).not.toHaveBeenCalled();
  });
});
