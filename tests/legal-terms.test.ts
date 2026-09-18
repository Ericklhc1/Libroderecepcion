import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  AI_ATTRIBUTION,
  TERMS_DOCUMENT,
  TERMS_VERSION,
} from '@/domain/legal';
import {
  acceptCurrentTerms,
  hasAcceptedCurrentTerms,
} from '@/server/services/legal-acceptance';

describe('términos versionados del Libro', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('exige una aceptación por usuario y versión', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    expect(await hasAcceptedCurrentTerms(user.id)).toBe(false);

    await acceptCurrentTerms(user, {
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(await hasAcceptedCurrentTerms(user.id)).toBe(true);

    const row = await prisma.legalAcceptance.findUniqueOrThrow({
      where: {
        userId_document_version: {
          userId: user.id,
          document: TERMS_DOCUMENT,
          version: TERMS_VERSION,
        },
      },
    });
    expect(row.version).toBe(TERMS_VERSION);
    expect(row.ip).toBe('127.0.0.1');
  });

  it('aceptar dos veces la misma versión no duplica registros', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    await acceptCurrentTerms(user);
    await acceptCurrentTerms(user);

    expect(
      await prisma.legalAcceptance.count({
        where: {
          userId: user.id,
          document: TERMS_DOCUMENT,
          version: TERMS_VERSION,
        },
      }),
    ).toBe(1);
  });

  it('el layout bloquea el Libro hasta aceptar la versión vigente', () => {
    const source = readFileSync('src/app/(app)/layout.tsx', 'utf-8');
    expect(source).toContain('hasAcceptedCurrentTerms');
    expect(source).toContain("redirect('/aceptar-terminos')");
  });

  it('la atribución LLM es única y se reutiliza en las interfaces de IA', () => {
    const fronti = readFileSync('src/components/layout/fronti-assistant.tsx', 'utf-8');
    const brief = readFileSync('src/components/operational/operational-brief.tsx', 'utf-8');
    const component = readFileSync('src/components/ai/ai-attribution.tsx', 'utf-8');

    expect(AI_ATTRIBUTION).toContain('Erick Herrera');
    expect(AI_ATTRIBUTION).toContain('Administradora de Recursos y Operaciones Hoteleras SpA');
    expect(component).toContain('AI_ATTRIBUTION');
    expect(fronti).toContain('AiAttribution');
    expect(brief).toContain('AiAttribution');
  });
});
