import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
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

async function createOperationalSignal(
  userId: string,
  input: {
    title: string;
    priority?: Priority;
    createdAt?: Date;
  },
) {
  return prisma.operationalEntry.create({
    data: {
      type: 'NOVEDAD',
      title: input.title,
      description: 'Señal operativa determinística para Fronti proactivo.',
      priority: input.priority ?? Priority.ALTA,
      requiresFollowUp: true,
      createdById: userId,
      createdAt: input.createdAt,
    },
  });
}

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

  it('no genera señales proactivas desde reservas PMS', async () => {
    await prisma.reservationReference.create({
      data: {
        code: 'PMS-NO-FRONTI-1',
        status: 'EN_CASA',
        guaranteeStatus: 'RECHAZADA',
        requiresAction: true,
        balanceDue: 99999,
        actionNote: 'Este dato pertenece al PMS, no al radar proactivo de AROH.',
      },
    });

    const candidates = await collectFrontiProactiveCandidates();
    expect(candidates.some((candidate) => candidate.entityType === 'ReservationReference')).toBe(false);
    expect(candidates.some((candidate) => candidate.link.startsWith('/central-reservas'))).toBe(false);
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
    const author = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción' });

    await createOperationalSignal(author.id, { title: 'Pendiente operativo con prioridad' });

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

  it('deduplica la misma señal durante la ventana de enfriamiento', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const author = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await prisma.user.update({
      where: { id: supervisor.id },
      data: { frontiAccessEnabled: true },
    });

    await createOperationalSignal(author.id, { title: 'Pendiente que sigue abierto' });

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
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador' });
    const author = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await createOperationalSignal(author.id, { title: 'No debe avisarse con Fronti apagado' });

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

  it('permite que una señal nueva avance aunque una anterior esté en cooldown', async () => {
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador' });
    const author = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await prisma.systemSetting.upsert({
      where: { key: 'fronti.proactiveMaxFindingsPerRun' },
      create: {
        key: 'fronti.proactiveMaxFindingsPerRun',
        value: 1,
        category: 'fronti',
      },
      update: { value: 1 },
    });

    await createOperationalSignal(author.id, {
      title: 'Primera señal crítica',
      priority: Priority.CRITICA,
    });
    const first = await runFrontiProactiveSweep({ trigger: 'test-limit-first' });
    expect(first.notified).toBe(1);

    await createOperationalSignal(author.id, {
      title: 'Segunda señal nueva',
      priority: Priority.ALTA,
    });
    const second = await runFrontiProactiveSweep({ trigger: 'test-limit-second' });
    expect(second.notified).toBe(1);
  });

  it('reclama concurrentemente cada señal una sola vez por destinatario', async () => {
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador' });
    const author = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await createOperationalSignal(author.id, {
      title: 'Señal para prueba concurrente',
      priority: Priority.CRITICA,
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

  it('cambia el fingerprint cuando una novedad escala de alta a crítica', async () => {
    const now = new Date();
    const author = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const entry = await createOperationalSignal(author.id, {
      title: 'Señal que escala',
      priority: Priority.ALTA,
      createdAt: now,
    });

    const before = (await collectFrontiProactiveCandidates(now)).find(
      (candidate) => candidate.entityId === entry.id,
    );

    await prisma.operationalEntry.update({
      where: { id: entry.id },
      data: { priority: Priority.CRITICA },
    });

    const after = (await collectFrontiProactiveCandidates(new Date(now.getTime() + 60_000))).find(
      (candidate) => candidate.entityId === entry.id,
    );

    expect(before?.severity).toBe('ALTA');
    expect(after?.severity).toBe('CRITICA');
    expect(after?.key).not.toBe(before?.key);
  });


  it('resume el aviso de Fronti sin copiar metadatos ni instrucciones genéricas', async () => {
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador Fronti' });
    const author = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción Fronti' });
    await createOperationalSignal(author.id, {
      title: 'Señal explicable',
      priority: Priority.CRITICA,
    });

    await runFrontiProactiveSweep({ trigger: 'test-explicacion' });

    const notification = await prisma.notification.findFirstOrThrow({
      where: {
        type: NotificationType.FRONTI_HALLAZGO,
        entity: 'FrontiProactiveSignal',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(notification.body).toBe('Señal operativa determinística para Fronti proactivo.');
    expect(notification.body!.length).toBeLessThanOrEqual(240);
    expect(notification.body).not.toContain('Qué pasó:');
    expect(notification.body).not.toContain('abre el origen');
    expect(notification.title).not.toContain('Fronti ·');
    expect(notification.link).toMatch(/^\/libro\//);
  });

  it('incorpora una novedad prioritaria recién creada al barrido', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción' });
    const entry = await createOperationalSignal(user.id, {
      title: 'Revisión prioritaria',
      priority: Priority.ALTA,
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

  it('detecta un descuadre de Caja con montos exactos y abre el arqueo concreto', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor descuadre Fronti',
    });
    const now = new Date('2026-09-30T12:00:00.000Z');

    const audit = await prisma.cashAudit.create({
      data: {
        id: 'fronti-cash-audit-difference',
        currency: 'CLP',
        expectedAmount: 100_000,
        countedAmount: 98_000,
        difference: -2_000,
        countedById: supervisor.id,
        guaranteeSnapshot: [],
        denominationSnapshot: [],
        createdAt: now,
      },
    });

    const candidates = await collectFrontiProactiveCandidates(now);
    const candidate = candidates.find((item) => item.entityId === audit.id);

    expect(candidate).toBeDefined();
    expect(candidate?.area).toBe('Caja');
    expect(candidate?.evidence).toContain('esperado CLP 100.000');
    expect(candidate?.evidence).toContain('contado CLP 98.000');
    expect(candidate?.evidence).toContain('diferencia CLP -2.000');
    expect(candidate?.evidence).toContain('no demuestra por sí sola la causa');
    expect(candidate?.link).toBe(`/caja/arqueos/${audit.id}`);
  });

  it('detecta una tarea vencida y enlaza directamente a la tarea', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor tarea Fronti',
    });
    const now = new Date('2026-09-30T12:00:00.000Z');
    const dueAt = new Date('2026-09-30T10:00:00.000Z');

    const task = await prisma.task.create({
      data: {
        title: 'Revisar diferencia pendiente',
        description: 'Tarea determinística para el radar de Fronti.',
        priority: Priority.ALTA,
        dueAt,
        assigneeId: supervisor.id,
        createdById: supervisor.id,
      },
    });

    const candidates = await collectFrontiProactiveCandidates(now);
    const candidate = candidates.find((item) => item.entityId === task.id);

    expect(candidate).toBeDefined();
    expect(candidate?.area).toBe('Tareas');
    expect(candidate?.title).toContain(`#${task.humanId}`);
    expect(candidate?.evidence).toContain('la fecha límite ya pasó');
    expect(candidate?.link).toBe(`/tareas/${task.id}`);
  });

});
