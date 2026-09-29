import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EntryType,
  GuaranteeKind,
  GuaranteeState,
  Impact,
  NotificationType,
  OperationalMailStatus,
  Priority,
  Severity,
} from '@prisma/client';
import { createEntry } from '@/server/services/entries';
import { createGuarantee } from '@/server/services/guarantees';
import { notify } from '@/server/notifications';
import {
  SUPERVISION_BACKUP_EMAIL,
  queueOperationalMail,
} from '@/server/services/operational-mail';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

describe('respaldo operativo por correo', () => {
  beforeAll(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
    await prisma.systemSetting.deleteMany({
      where: { key: { startsWith: 'notification.email.' } },
    });
  });

  it('encola una novedad con detalle para Supervisión', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción correo',
    });

    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Late checkout autorizado',
      description: 'Habitación 507 autorizada hasta las 14:00.',
      priority: Priority.MEDIA,
      tags: ['habitacion-507'],
      requiresFollowUp: false,
    });

    const row = await prisma.operationalMailOutbox.findUniqueOrThrow({
      where: { eventKey: `entry-created:${entry.id}` },
    });

    expect(row.status).toBe(OperationalMailStatus.PENDIENTE);
    expect(row.recipients).toEqual([SUPERVISION_BACKUP_EMAIL]);
    expect(row.subject).toContain('NOVEDAD');
    expect(row.text).toContain('Late checkout autorizado');
    expect(row.text).toContain('Habitación 507 autorizada hasta las 14:00.');
    expect(row.text).toContain(user.name);
  });

  it('encola una incidencia con gravedad y trazabilidad', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción incidente',
    });

    const entry = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Falla de cerradura',
      description: 'La cerradura no responde.',
      priority: Priority.ALTA,
      severity: Severity.ALTA,
      impact: Impact.HUESPED,
      immediateAction: 'Se entregó llave de respaldo.',
      tags: ['cerradura'],
      requiresFollowUp: true,
    });

    const row = await prisma.operationalMailOutbox.findUniqueOrThrow({
      where: { eventKey: `entry-created:${entry.id}` },
    });
    expect(row.subject).toContain('INCIDENCIA');
    expect(row.text).toContain('Gravedad: ALTA');
    expect(row.text).toContain('Impacto: HUESPED');
    expect(row.text).toContain('Se entregó llave de respaldo.');
  });

  it('encola el registro de una garantía con contexto operativo', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción garantía',
    });

    const guarantee = await createGuarantee(user, {
      kind: GuaranteeKind.EFECTIVO,
      amount: 80_000,
      currency: 'CLP',
      state: GuaranteeState.PENDIENTE,
      guestName: 'Huésped Prueba',
      roomNumber: '507',
      reference: 'GAR-TEST',
      notes: 'Depósito pendiente de activación.',
    });

    const row = await prisma.operationalMailOutbox.findUniqueOrThrow({
      where: { eventKey: `guarantee-created:${guarantee.id}` },
    });
    expect(row.recipients).toEqual([SUPERVISION_BACKUP_EMAIL]);
    expect(row.subject).toContain('GARANTÍA');
    expect(row.text).toContain('Huésped Prueba');
    expect(row.text).toContain('507');
    expect(row.text).toContain('80000');
  });

  it('envía las novedades internas al correo individual habilitado', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción correo individual',
    });
    const email = 'recepcionista.prueba@example.com';
    await prisma.user.update({
      where: { id: user.id },
      data: { email, emailNotificationsEnabled: true },
    });

    await notify({
      userId: user.id,
      type: NotificationType.TAREA_ASIGNADA,
      title: 'Nueva tarea operativa',
      body: 'Revisar el pendiente antes del cierre.',
      link: '/tareas',
    });

    const row = await prisma.operationalMailOutbox.findFirstOrThrow({
      where: { recipients: { has: email } },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.subject).toContain('Nueva tarea operativa');
    expect(row.text).toContain('Revisar el pendiente antes del cierre.');
    expect(row.text).toContain('/tareas');
  });

  it('respeta la preferencia de no recibir novedades por correo', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción sin correo operativo',
    });
    const email = 'sin-avisos@example.com';
    await prisma.user.update({
      where: { id: user.id },
      data: { email, emailNotificationsEnabled: false },
    });

    await notify({
      userId: user.id,
      type: NotificationType.TAREA_ASIGNADA,
      title: 'No debe salir por correo',
    });

    expect(
      await prisma.operationalMailOutbox.count({
        where: { recipients: { has: email } },
      }),
    ).toBe(0);
  });

  it('envía una notificación obligatoria aunque el usuario desactive avisos opcionales', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción correo obligatorio',
    });
    const email = 'obligatorio@example.com';
    await prisma.user.update({
      where: { id: user.id },
      data: { email, emailNotificationsEnabled: false },
    });

    await notify({
      userId: user.id,
      type: NotificationType.INCIDENCIA_CRITICA,
      title: 'Incidencia crítica obligatoria',
      body: 'Requiere atención inmediata.',
    });

    const row = await prisma.operationalMailOutbox.findFirstOrThrow({
      where: { recipients: { has: email } },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.subject).toContain('Incidencia crítica obligatoria');
  });

  it('la consola puede desactivar el correo para un tipo que normalmente respeta preferencia', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción política personalizada',
    });
    const email = 'politica@example.com';
    await prisma.user.update({
      where: { id: user.id },
      data: { email, emailNotificationsEnabled: true },
    });
    await prisma.systemSetting.create({
      data: {
        key: 'notification.email.TAREA_ASIGNADA',
        value: 'DESACTIVADO',
        category: 'notificaciones-correo',
      },
    });

    await notify({
      userId: user.id,
      type: NotificationType.TAREA_ASIGNADA,
      title: 'No debe enviarse por política',
    });

    expect(
      await prisma.operationalMailOutbox.count({
        where: { recipients: { has: email } },
      }),
    ).toBe(0);
  });

  it('no transforma chat ni alarmas en correo', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción señales inmediatas',
    });
    const email = 'solo-operativo@example.com';
    await prisma.user.update({
      where: { id: user.id },
      data: { email, emailNotificationsEnabled: true },
    });

    await notify([
      {
        userId: user.id,
        type: NotificationType.CHAT_MENSAJE,
        title: 'Mensaje de chat',
      },
      {
        userId: user.id,
        type: NotificationType.ALARMA,
        title: 'Timer',
      },
    ]);

    expect(
      await prisma.operationalMailOutbox.count({
        where: { recipients: { has: email } },
      }),
    ).toBe(0);
  });

  it('eventKey hace idempotente la cola', async () => {
    await queueOperationalMail(prisma, {
      eventKey: 'test:idempotente',
      recipients: [SUPERVISION_BACKUP_EMAIL],
      subject: 'Primero',
      text: 'Primer cuerpo',
    });
    await queueOperationalMail(prisma, {
      eventKey: 'test:idempotente',
      recipients: [SUPERVISION_BACKUP_EMAIL],
      subject: 'Segundo',
      text: 'Segundo cuerpo',
    });

    expect(
      await prisma.operationalMailOutbox.count({ where: { eventKey: 'test:idempotente' } }),
    ).toBe(1);
    const row = await prisma.operationalMailOutbox.findUniqueOrThrow({
      where: { eventKey: 'test:idempotente' },
    });
    expect(row.subject).toBe('Primero');
  });
});
