import 'server-only';

import { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  TERMS_DOCUMENT,
  TERMS_TITLE,
  TERMS_VERSION,
} from '@/domain/legal';
import { recordAudit } from '@/server/audit';

export async function hasAcceptedCurrentTerms(userId: string): Promise<boolean> {
  const acceptance = await prisma.legalAcceptance.findUnique({
    where: {
      userId_document_version: {
        userId,
        document: TERMS_DOCUMENT,
        version: TERMS_VERSION,
      },
    },
    select: { id: true },
  });
  return Boolean(acceptance);
}

export async function acceptCurrentTerms(
  user: { id: string; sessionId: string; name: string },
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const acceptance = await prisma.legalAcceptance.upsert({
    where: {
      userId_document_version: {
        userId: user.id,
        document: TERMS_DOCUMENT,
        version: TERMS_VERSION,
      },
    },
    update: {},
    create: {
      userId: user.id,
      document: TERMS_DOCUMENT,
      version: TERMS_VERSION,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  await recordAudit({
    entity: 'LegalAcceptance',
    entityId: acceptance.id,
    action: AuditAction.CONFIGURAR,
    user,
    summary: `${user.name} aceptó «${TERMS_TITLE}» versión ${TERMS_VERSION}`,
    after: {
      document: TERMS_DOCUMENT,
      version: TERMS_VERSION,
      acceptedAt: acceptance.acceptedAt,
    },
  });

  return acceptance;
}
