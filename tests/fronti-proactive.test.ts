import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  NotificationType,
} from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  collectFrontiProactiveCandidates,
  runFrontiProactiveSweep,
} from '@/server/ai/fronti-proactive';

describe('Fronti proactivo', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('convierte una alerta crítica en un aviso proactivo sin cambiar el estado operativo', async () => {
    await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción' });
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisión' });
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Sistema' });

    const alert = await prisma.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        status: AlertStatus.NUEVA,
        title: 'Garantía y salida requieren revisión',
        message: 'La salida está próxima y existe una condición abierta.',
        auto: false,
      },
    });

    const candidates = await collectFrontiProactiveCandidates();
    expect(candidates.some((candidate) => candidate.entityId === alert.id)).toBe(true);

    const result = await runFrontiProactiveSweep({ trigger: 'test' });
    expect(result.enabled).toBe(true);
    expect(result.analysed).toBeGreaterThanOrEqual(1);

    const notifications = await prisma.notification.findMany({
      where: {
        type: NotificationType.FRONTI_HALLAZGO,
        entity: 'FrontiProactiveSignal',
      },
      orderBy: { userId: 'asc' },
    });
    expect(new Set(notifications.map((item) => item.userId))).toEqual(
      new Set([supervisor.id, admin.id]),
    );
    expect(notifications.every((item) => item.title.startsWith('Fronti ·'))).toBe(true);

    const untouched = await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(untouched.status).toBe(AlertStatus.NUEVA);
  });

  it('deduplica la misma señal durante la ventana de enfriamiento', async () => {
    await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });

    await prisma.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        status: AlertStatus.NUEVA,
        title: 'Señal persistente',
        message: 'La condición sigue abierta.',
        auto: false,
      },
    });

    const first = await runFrontiProactiveSweep({ trigger: 'test-first' });
    const second = await runFrontiProactiveSweep({ trigger: 'test-second' });

    expect(first.notified).toBe(2);
    expect(second.notified).toBe(0);
    expect(second.skippedCooldown).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.notification.count({
        where: {
          type: NotificationType.FRONTI_HALLAZGO,
          entity: 'FrontiProactiveSignal',
        },
      }),
    ).toBe(2);
  });
});
