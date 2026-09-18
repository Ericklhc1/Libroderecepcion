import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationType } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { reportFrontiFinding } from '@/server/ai/fronti-findings';

describe('hallazgos de Fronti', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('notifica sólo a Supervisor y Administrador de sistema', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción',
    });
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisión',
    });
    const admin = await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      name: 'Sistema',
    });
    const other = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Otra recepción',
    });

    const result = await reportFrontiFinding(receptionist, {
      kind: 'FALLO',
      severity: 'ALTA',
      area: 'Check-out',
      title: 'El lote puede quedar parcialmente aplicado',
      evidence: 'La primera salida se confirma antes de validar el resultado de la segunda.',
      recommendation: 'Ejecutar el lote completo dentro de una sola transacción.',
    });

    expect(result.notified).toBe(2);

    const notifications = await prisma.notification.findMany({
      where: { type: NotificationType.FRONTI_HALLAZGO },
      orderBy: { userId: 'asc' },
    });
    expect(notifications).toHaveLength(2);
    expect(new Set(notifications.map((item) => item.userId))).toEqual(
      new Set([supervisor.id, admin.id]),
    );
    expect(notifications.some((item) => item.userId === receptionist.id)).toBe(false);
    expect(notifications.some((item) => item.userId === other.id)).toBe(false);
    expect(notifications[0]!.entity).toBe('FrontiFinding');
    expect(notifications[0]!.body).toContain('Evidencia:');
  });

  it('deduplica el mismo hallazgo durante 24 horas', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });

    const finding = {
      kind: 'MEJORA' as const,
      severity: 'MEDIA' as const,
      area: 'Entrega de turno',
      title: 'Demasiados pasos repetidos',
      evidence: 'El mismo dato se solicita en dos etapas consecutivas del flujo.',
      recommendation: 'Reutilizar el dato ya confirmado en la etapa anterior.',
    };

    const first = await reportFrontiFinding(receptionist, finding);
    const second = await reportFrontiFinding(receptionist, finding);

    expect(first.notified).toBe(2);
    expect(second.notified).toBe(0);
    expect(second.deduplicated).toBe(2);
    expect(
      await prisma.notification.count({
        where: { type: NotificationType.FRONTI_HALLAZGO },
      }),
    ).toBe(2);
  });
});
