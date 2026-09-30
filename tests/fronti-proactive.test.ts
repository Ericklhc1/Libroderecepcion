import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  GuaranteeStatus,
  NotificationType,
  Priority,
  ReservationStatus,
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

async function createOperationalCandidate(createdById: string, suffix = '1') {
  return prisma.operationalEntry.create({
    data: {
      type: 'NOVEDAD',
      title: `Continuidad prioritaria ${suffix}`,
      description: 'Hecho operativo que requiere atención en AROH.',
      priority: Priority.ALTA,
      requiresFollowUp: true,
      createdById,
    },
  });
}

describe('Fronti proactivo · frontera no PMS', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('no convierte una señal Alert legada en hallazgo proactivo', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisión' });
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Sistema' });
    await prisma.user.update({
      where: { id: supervisor.id },
      data: { frontiAccessEnabled: true },
    });

    const alert = await prisma.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        status: AlertStatus.NUEVA,
        title: 'Señal técnica histórica',
        message: 'Compatibilidad interna; no debe convertirse en una segunda alerta de Fronti.',
        auto: false,
      },
    });

    const candidates = await collectFrontiProactiveCandidates();
    expect(candidates.some((candidate) => candidate.entityId === alert.id)).toBe(false);
  });

  it('no vigila estados PMS, llegadas ni reservas como hallazgos proactivos', async () => {
    await prisma.reservationReference.create({
      data: {
        code: 'PMS-NO-AROH-1',
        status: ReservationStatus.EN_CASA,
        guaranteeStatus: GuaranteeStatus.RECHAZADA,
        requiresAction: true,
        actionNote: 'Aunque el PMS tenga una excepción, no es un hallazgo proactivo de AROH.',
      },
    });

    const candidates = await collectFrontiProactiveCandidates();
    expect(candidates.some((candidate) => candidate.entityType === 'ReservationReference')).toBe(false);
    expect(candidates.some((candidate) => candidate.link.startsWith('/central-reservas'))).toBe(false);
  });

  it('una novedad prioritaria recién creada sí entra al barrido', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción' });
    const entry = await createOperationalCandidate(user.id);

    const candidates = await collectFrontiProactiveCandidates(entry.createdAt);
    expect(
      candidates.some(
        (candidate) =>
          candidate.entityType === 'OperationalEntry' &&
          candidate.entityId === entry.id &&
          candidate.link === `/libro/${entry.id}`,
      ),
    ).toBe(true);
  });

  it('no envía Fronti proactivo a un Supervisor que no tiene Fronti asignado', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor sin Fronti',
    });
    const admin = await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      name: 'Administrador',
    });
    await createOperationalCandidate(admin.id, 'access');

    const result = await runFrontiProactiveSweep({ trigger: 'test-access' });
    expect(result.notified).toBe(1);

    const recipientIds = (
      await prisma.notification.findMany({
        where: {
          type: NotificationType.FRONTI_HALLAZGO,
          entity: 'FrontiProactiveSignal',
        },
        select: { userId: true },
      })
    ).map((item) => item.userId);

    expect(recipientIds).toContain(admin.id);
    expect(recipientIds).not.toContain(supervisor.id);
  });

  it('deduplica la misma novedad durante la ventana de enfriamiento', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    await prisma.user.update({
      where: { id: supervisor.id },
      data: { frontiAccessEnabled: true },
    });
    await createOperationalCandidate(admin.id, 'cooldown');

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

  it('respeta el interruptor global de Fronti', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador' });
    await createOperationalCandidate(admin.id, 'off');
    await prisma.systemSetting.upsert({
      where: { key: 'fronti.enabled' },
      create: { key: 'fronti.enabled', value: false, category: 'fronti' },
      update: { value: false },
    });

    const result = await runFrontiProactiveSweep({ trigger: 'test-disabled' });
    expect(result.enabled).toBe(false);
    expect(
      await prisma.notification.count({
        where: { type: NotificationType.FRONTI_HALLAZGO },
      }),
    ).toBe(0);
  });

  it('reclama concurrentemente cada señal una sola vez por destinatario', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador' });
    await createOperationalCandidate(admin.id, 'claim');

    const [a, b] = await Promise.all([
      runFrontiProactiveSweep({ trigger: 'test-concurrency-a' }),
      runFrontiProactiveSweep({ trigger: 'test-concurrency-b' }),
    ]);

    expect(a.notified + b.notified).toBe(1);
    expect(
      await prisma.notification.count({
        where: {
          type: NotificationType.FRONTI_HALLAZGO,
          entity: 'FrontiProactiveSignal',
        },
      }),
    ).toBe(1);
  });
});
