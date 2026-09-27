import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import { respondAlarm } from '@/server/services/alarms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ recipientId: z.string().min(1), action: z.literal('ACK') }),
  z.object({
    recipientId: z.string().min(1),
    action: z.literal('SNOOZE'),
    minutes: z.number().int().refine((value) => [5, 10, 15, 30, 60].includes(value)),
  }),
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) {
    return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());
    await respondAlarm(user, input);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No fue posible actualizar la alarma.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
