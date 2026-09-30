import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  EntryType,
  NotificationType,
  Priority,
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

    const result = await runFrontiProactiveSweep({ trigger: 'test' });
    expect(result.enabled).toBe(true);
    expect(
      await prisma.notification.count({
        where: {
          type: NotificationType.FRONTI_HALLAZGO,
          entity: 'FrontiProactiveSignal',
        },
      }),
    ).toBe(0);

    const untouched = await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(untouched.status).toBe(AlertStatus.NUEVA);
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

    await prisma.operationalEntry.create({
      data: {
        type: EntryType.INCIDENCIA,
        title: 'Incidencia crítica visible para Fronti',
        description: 'Señal operacional para probar asignación individual.',
        priority: Priority.CRITICA,
        createdById: admin.id,
      },
    });

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

  it('no convierte referencias PMS en señales proactivas', async () => {
    await prisma.reservationReference.create({
      data: {
        code: 'PMS-ONLY-1',
        requiresAction: true,
        actionNote: 'Dato PMS que AROH no debe convertir en hallazgo.',
      },
    });

    const candidates = await collectFrontiProactiveCandidates();
    expect(candidates.some((candidate) => candidate.entityType === 'ReservationReference')).toBe(false);
    expect(candidates.some((candidate) => candidate.link.startsWith('/central-reservas'))).toBe(false);
  });

  it('deduplica la misma señal durante la ventana de enfriamiento', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    await prisma.user.update({
      where: { id: supervisor.id },
      data: { frontiAccessEnabled: true },
    });

    await prisma.operationalEntry.create({
      data: {
        type: EntryType.INCIDENCIA,
        title: 'Incidencia crítica persistente',
        description: 'La condición sigue abierta.',
        priority: Priority.CRITICA,
        createdById: admin.id,
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

  it('respeta el interruptor global de Fronti', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador' });
    await prisma.systemSetting.upsert({
      where: { key: 'fronti.enabled' },
      create: { key: 'fronti.enabled', value: false, category: 'fronti' },
      update: { value: false },
    });
    await prisma.operationalEntry.create({
      data: {
        type: EntryType.INCIDENCIA,
        title: 'Señal con Fronti apagado',
        description: 'No debe notificarse.',
        priority: Priority.CRITICA,
        createdById: admin.id,
      },
    });

    const result = await runFrontiProactiveSweep({ trigger: 'test-disabled' });
    expect(result.enabled).toBe(false);
    expect(
      await prisma.notification.count({
        where: { type: NotificationType.FRONTI_HALLAZGO },
      }),
    ).toBe(0);
  });

  it('permite que una señal nueva avance aunque las primeras estén en cooldown', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador' });
    await prisma.systemSetting.upsert({
      where: { key: 'fronti.proactiveMaxFindingsPerRun' },
      create: {
        key: 'fronti.proactiveMaxFindingsPerRun',
        value: 1,
        category: 'fronti',
      },
      update: { value: 1 },
    });

    await prisma.operationalEntry.create({
      data: {
        type: EntryType.INCIDENCIA,
        title: 'Primera señal crítica',
        description: 'Primera condición para cooldown.',
        priority: Priority.CRITICA,
        createdById: admin.id,
      },
    });
    const first = await runFrontiProactiveSweep({ trigger: 'test-limit-first' });
    expect(first.notified).toBe(1);

    await prisma.operationalEntry.create({
      data: {
        type: EntryType.NOVEDAD,
        title: 'Segunda señal alta',
        description: 'Debe poder avanzar aunque la primera esté en cooldown.',
        priority: Priority.ALTA,
        createdById: admin.id,
      },
    });
    const second = await runFrontiProactiveSweep({ trigger: 'test-limit-second' });
    expect(second.notified).toBe(1);
  });

  it('reclama concurrentemente cada señal una sola vez por destinatario', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador' });
    await prisma.operationalEntry.create({
      data: {
        type: EntryType.INCIDENCIA,
        title: 'Señal concurrente',
        description: 'Sólo una ejecución debe reclamarla.',
        priority: Priority.CRITICA,
        createdById: admin.id,
      },
    });

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

  it('escala una habitación cuando aumenta la concentración de riesgo operativo', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción' });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '512' } });

    for (let index = 0; index < 4; index += 1) {
      await prisma.operationalEntry.create({
        data: {
          type: EntryType.NOVEDAD,
          title: `Contexto acumulado ${index + 1}`,
          description: 'Contexto operacional sin prioridad crítica.',
          priority: Priority.MEDIA,
          roomId: room.id,
          createdById: user.id,
        },
      });
    }

    const before = (await collectFrontiProactiveCandidates()).find(
      (candidate) => candidate.entityType === 'Room' && candidate.entityId === room.id,
    );
    expect(before?.severity).toBe('ALTA');

    for (let index = 0; index < 2; index += 1) {
      await prisma.operationalEntry.create({
        data: {
          type: EntryType.INCIDENCIA,
          title: `Crítico habitación 512 · ${index + 1}`,
          description: 'Escala el contexto de la habitación.',
          priority: Priority.CRITICA,
          roomId: room.id,
          createdById: user.id,
        },
      });
    }

    const after = (await collectFrontiProactiveCandidates()).find(
      (candidate) => candidate.entityType === 'Room' && candidate.entityId === room.id,
    );

    expect(after?.severity).toBe('CRITICA');
    expect(after?.key).not.toBe(before?.key);
    expect(after?.link).toBe('/libro/habitaciones?habitacion=512');
  });

  it('incorpora una novedad prioritaria recién creada al barrido', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción' });
    const entry = await prisma.operationalEntry.create({
      data: {
        type: 'NOVEDAD',
        title: 'Revisión prioritaria',
        description: 'Caso recién creado para Fronti.',
        priority: 'ALTA',
        requiresFollowUp: true,
        createdById: user.id,
      },
    });

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

});
