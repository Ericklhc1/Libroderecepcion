import 'server-only';

import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { getMyOpenShift } from '@/server/services/shifts';

/**
 * Contexto del turno creado por otros recepcionistas. Nunca incluye memoria
 * PERSONAL; sólo recuerdos explícitamente clasificados como TURNO y ligados al
 * mismo turno operativo. El estado real siempre debe verificarse con las
 * herramientas del Libro.
 */
export async function getSharedShiftMemoryContext(
  user: CurrentUser,
): Promise<string | null> {
  const shift = await getMyOpenShift(user.id);
  if (!shift) return null;

  const rows = await prisma.$queryRaw<
    Array<{
      summary: string;
      entity_type: string | null;
      entity_id: string | null;
      importance: number;
      updated_at: Date;
    }>
  >`
    SELECT summary, entity_type, entity_id, importance, updated_at
      FROM ai_memory
     WHERE scope = 'TURNO'
       AND shift_id = ${shift.id}
       AND user_id <> ${user.id}
       AND expires_at > NOW()
     ORDER BY importance DESC, updated_at DESC
     LIMIT 12
  `;

  if (!rows.length) return null;
  return rows
    .map((row) => {
      const entity = row.entity_id
        ? ` · ${row.entity_type ?? 'referencia'} ${row.entity_id}`
        : '';
      return `- ${row.summary}${entity}`;
    })
    .join('\n');
}
