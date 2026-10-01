import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/server/auth/current-user';
const state = vi.hoisted(() => ({ committed: false, rollback: false, muted: false, schedule: vi.fn() }));
vi.mock('@/server/services/web-push-scheduler', () => ({ scheduleWebPushForUsers: state.schedule }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  chatParticipant: { findFirst: async () => ({ conversationId: 'conversation' }) },
  $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    const result = await callback({
      chatConversation: {
        findFirst: async () => ({ id: 'conversation', type: 'DIRECTO', participants: [
          { userId: 'sender', mutedUntil: null },
          { userId: 'recipient', mutedUntil: state.muted ? new Date(Date.now() + 60000) : null },
        ] }), update: async () => ({}),
      },
      chatMessage: { create: async () => ({ id: 'message' }) },
      chatParticipant: { updateMany: async () => ({ count: 1 }) },
      notification: { findFirst: async () => null, create: async () => ({ id: 'notification' }) },
    });
    if (state.rollback) throw new Error('commit failed');
    state.committed = true;
    return result;
  },
} }));
import { sendChatMessage } from '@/server/services/chat';
const sender = { id: 'sender', name: 'Erick', roleOperational: true } as CurrentUser;

describe('chat guarda antes de solicitar push', () => {
  beforeEach(() => { state.committed = false; state.rollback = false; state.muted = false; state.schedule.mockReset(); });
  it('despacha al receptor después del commit, sin avisar al remitente', async () => {
    state.schedule.mockImplementation(ids => { expect(state.committed).toBe(true); expect(ids).toEqual(['recipient']); });
    await expect(sendChatMessage(sender, { conversationId: 'conversation', body: 'Hola' })).resolves.toEqual({ id: 'message' });
    expect(state.schedule).toHaveBeenCalledTimes(1);
  });
  it('no programa notificaciones cuando falla el commit', async () => {
    state.rollback = true;
    await expect(sendChatMessage(sender, { conversationId: 'conversation', body: 'Hola' })).rejects.toThrow('commit failed');
    expect(state.schedule).not.toHaveBeenCalled();
  });
  it('respeta una conversación silenciada', async () => {
    state.muted = true;
    await sendChatMessage(sender, { conversationId: 'conversation', body: 'Hola' });
    expect(state.schedule).toHaveBeenCalledWith([]);
  });
});
