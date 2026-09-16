import 'server-only';

import { prisma } from '@/lib/prisma';
import { getFrontiConfig } from './fronti-config';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aplica la política vigente también a registros creados antes de un cambio
 * administrativo. Así reducir 30 → 7 días tiene efecto real y no espera al
 * expires_at calculado con la configuración anterior.
 */
export async function enforceFrontiRetentionPolicy(): Promise<{
  messages: number;
  memories: number;
  conversations: number;
}> {
  const config = await getFrontiConfig();
  const personalCutoff = new Date(Date.now() - config.memoryRetentionDays * DAY_MS);
  const shiftCutoff = new Date(Date.now() - config.shiftMemoryHours * 60 * 60 * 1000);

  const [messages, memories, conversations] = await prisma.$transaction([
    prisma.$executeRaw`
      DELETE FROM ai_message
       WHERE expires_at <= NOW()
          OR created_at <= ${personalCutoff}
    `,
    prisma.$executeRaw`
      DELETE FROM ai_memory
       WHERE expires_at <= NOW()
          OR (scope = 'PERSONAL' AND updated_at <= ${personalCutoff})
          OR (scope = 'TURNO' AND updated_at <= ${shiftCutoff})
    `,
    prisma.$executeRaw`
      DELETE FROM ai_conversation
       WHERE expires_at <= NOW()
          OR last_active_at <= ${personalCutoff}
    `,
  ]);

  return { messages, memories, conversations };
}
