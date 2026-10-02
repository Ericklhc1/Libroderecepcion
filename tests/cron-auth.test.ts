import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthorizedCronRequest } from '@/server/cron-auth';
import { GET as memory } from '@/app/api/cron/ai-memory/route';
import { GET as proactive } from '@/app/api/cron/fronti-proactive/route';
import { GET as mail } from '@/app/api/cron/operational-mail/route';
import { GET as push } from '@/app/api/cron/web-push/route';
const effects = vi.hoisted(() => ({ automations: vi.fn(), coordination: vi.fn(), retention: vi.fn(), alerts: vi.fn(), fronti: vi.fn(), mail: vi.fn(), hk: vi.fn(), alarms: vi.fn(), push: vi.fn() }));
vi.mock('@/server/services/operational-automation', () => ({ runOperationalAutomations: effects.automations }));
vi.mock('@/server/services/coordination', () => ({ escalateUnreceivedWork: effects.coordination }));
vi.mock('@/server/ai/retention-policy', () => ({ enforceFrontiRetentionPolicy: effects.retention }));
vi.mock('@/server/services/alert-engine', () => ({ runAlertEngine: effects.alerts }));
vi.mock('@/server/ai/fronti-proactive', () => ({ runFrontiProactiveSweep: effects.fronti }));
vi.mock('@/server/services/operational-mail', () => ({ flushOperationalMailOutbox: effects.mail }));
vi.mock('@/server/services/housekeeping', () => ({ escalateHousekeepingRequests: effects.hk }));
vi.mock('@/server/services/operational-alarms', () => ({ dispatchDueAlarmsForAllUsers: effects.alarms }));
vi.mock('@/server/services/web-push', () => ({ flushWebPushSubscriptions: effects.push }));
const secret = 'cron-exclusivamente-sintetico';
const cases: Array<{ name: string; secret: string | undefined; headers: Record<string,string> }> = [
 { name: 'secreto ausente', secret: undefined, headers: { 'user-agent': 'vercel-cron/synthetic' } },
 { name: 'secreto vacío', secret: '', headers: { authorization: 'Bearer cualquiera', 'user-agent': 'vercel-cron/synthetic' } },
 { name: 'secreto de espacios', secret: '  ', headers: { 'user-agent': 'vercel-cron/synthetic' } },
 { name: 'token ausente', secret, headers: {} },
 { name: 'token incorrecto', secret, headers: { authorization: 'Bearer incorrecto' } },
 { name: 'UA sin token', secret, headers: { 'user-agent': 'vercel-cron/synthetic' } },
];
const request = (headers: Record<string,string>) => new Request('https://synthetic.invalid/cron', { headers });
beforeEach(() => { for (const effect of Object.values(effects)) effect.mockReset().mockResolvedValue({}); });
afterEach(() => vi.unstubAllEnvs());
describe('cron requiere secreto y token válidos', () => {
 it.each(cases)('$name: función rechaza', c => { vi.stubEnv('CRON_SECRET', c.secret); expect(isAuthorizedCronRequest(request(c.headers))).toBe(false); });
 it('función acepta el token correcto', () => { vi.stubEnv('CRON_SECRET', secret); expect(isAuthorizedCronRequest(request({ authorization: `Bearer ${secret}` }))).toBe(true); });
 for (const [name, handler] of Object.entries({ memory, proactive, mail, push })) {
  describe(name, () => {
   it.each(cases)('$name: handler rechaza y no invoca servicios', async c => {
    vi.stubEnv('CRON_SECRET', c.secret); const response = await handler(request(c.headers));
    expect(response.status).toBe(401);
    for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
   });
   it('token correcto conserva ejecución autorizada', async () => {
    vi.stubEnv('CRON_SECRET', secret); const response = await handler(request({ authorization: `Bearer ${secret}` }));
    expect(response.status).toBe(200);
    const expected = name === 'memory' ? ['retention'] : name === 'proactive' ? ['alerts','fronti'] : name === 'mail' ? ['mail'] : ['automations','coordination','hk','alarms','push'];
    for (const [key, effect] of Object.entries(effects)) expect(effect).toHaveBeenCalledTimes(expected.includes(key) ? 1 : 0);
    if (name === 'mail') expect(effects.mail).toHaveBeenCalledWith(40);
    if (name === 'proactive') expect(effects.fronti).toHaveBeenCalledWith({ trigger: 'vercel-cron', deadlineAt: expect.any(Number) });
   });
  });
 }
});
