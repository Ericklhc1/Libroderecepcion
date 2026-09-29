import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  GuaranteeStatus,
  NotificationType,
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
    await prisma.user.update({
      where: { id: supervisor.id },
      data: { frontiAccessEnabled: true },
    });

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

  it('no envía Fronti proactivo a un Supervisor que no tiene Fronti asignado', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor sin Fronti',
    });
    const admin = await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      name: 'Administrador',
    });

    await prisma.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        status: AlertStatus.NUEVA,
        title: 'Señal sólo para cuentas con Fronti',
        message: 'Prueba de asignación individual.',
        auto: false,
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

  it('no filtra datos proactivos de un módulo cuyo permiso fue retirado al usuario', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor acotado',
    });
    const admin = await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      name: 'Administrador',
    });
    await prisma.user.update({
      where: { id: supervisor.id },
      data: { frontiAccessEnabled: true },
    });

    await prisma.rolePermission.deleteMany({
      where: {
        roleId: supervisor.roleId,
        permission: { key: 'reservation.center.view' },
      },
    });

    await prisma.reservationReference.create({
      data: {
        code: 'FRONTI-PERM-1',
        status: ReservationStatus.EN_CASA,
        guaranteeStatus: GuaranteeStatus.RECHAZADA,
        requiresAction: true,
        actionNote: 'No debe filtrarse a quien perdió el permiso.',
      },
    });

    const result = await runFrontiProactiveSweep({ trigger: 'test-permission' });
    expect(result.notified).toBe(1);

    const notifications = await prisma.notification.findMany({
      where: {
        type: NotificationType.FRONTI_HALLAZGO,
        entity: 'FrontiProactiveSignal',
        link: { startsWith: '/central-reservas' },
      },
      select: { userId: true },
    });

    expect(notifications.map((item) => item.userId)).toEqual([admin.id]);
    expect(notifications.some((item) => item.userId === supervisor.id)).toBe(false);
  });

  it('deduplica la misma señal durante la ventana de enfriamiento', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    await prisma.user.update({
      where: { id: supervisor.id },
      data: { frontiAccessEnabled: true },
    });

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
