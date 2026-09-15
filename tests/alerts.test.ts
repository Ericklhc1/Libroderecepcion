import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  EntryStatus,
  EntryType,
  GuaranteeStatus,
  Priority,
  ReservationStatus,
  Severity,
  TaskStatus,
} from '@prisma/client';
import { ROLE_KEYS, createUser, prisma, resetOperationalData, seedCatalog } from './helpers';
import { countLiveAlerts, runAlertEngine } from '@/server/services/alert-engine';
import {
  acknowledgeAlert,
  createManualAlert,
  resolveAlert,
  restoreAlert,
  snoozeAlert,
  softDeleteAlert,
} from '@/server/services/alerts';
import { changeEntryStatus, createEntry } from '@/server/services/entries';
import { changeTaskStatus, createTask } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import type { CurrentUser } from '@/server/auth/current-user';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);

describe('motor de alertas', () => {
  let user: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    user = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  it('genera alerta por tarea vencida y no la duplica al reejecutarse', async () => {
    const task = await createTask(user, {
      title: 'Solicitar medio de pago alternativo',
      priority: Priority.ALTA,
      tags: [],
      checklist: [],
      dueAt: hoursAgo(3),
    });

    const first = await runAlertEngine();
    expect(first.created).toBe(1);

    const second = await runAlertEngine();
    expect(second.created).toBe(0);

    const alerts = await prisma.alert.findMany({ where: { taskId: task.id } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.type).toBe(AlertType.TAREA_VENCIDA);
    expect(alerts[0]?.level).toBe(AlertLevel.CRITICA);
    expect(alerts[0]?.auto).toBe(true);
    expect(alerts[0]?.dedupeKey).toBe(`task-overdue:${task.id}`);
  });

  it('resuelve sola la alerta cuando la condición desaparece', async () => {
    const task = await createTask(user, {
      title: 'Tarea que se completará',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
      dueAt: hoursAgo(2),
    });
    await runAlertEngine();

    await changeTaskStatus(user, { id: task.id, status: TaskStatus.COMPLETADA });
    const result = await runAlertEngine();

    expect(result.resolved).toBeGreaterThanOrEqual(1);
    const alert = await prisma.alert.findFirstOrThrow({ where: { taskId: task.id } });
    expect(alert.status).toBe(AlertStatus.RESUELTA);
    expect(alert.resolutionNote).toContain('condición de origen ya no se cumple');
  });

  it('reabre la alerta si la condición vuelve a cumplirse', async () => {
    const task = await createTask(user, {
      title: 'Tarea que se reabre',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
      dueAt: hoursAgo(2),
    });
    await runAlertEngine();
    await changeTaskStatus(user, { id: task.id, status: TaskStatus.COMPLETADA });
    await runAlertEngine();

    await changeTaskStatus(user, { id: task.id, status: TaskStatus.EN_CURSO });
    const result = await runAlertEngine();

    expect(result.reopened).toBe(1);
    const alert = await prisma.alert.findFirstOrThrow({ where: { taskId: task.id } });
    expect(alert.status).toBe(AlertStatus.NUEVA);
    expect(alert.resolvedAt).toBeNull();
  });

  it('alerta por incidencia crítica abierta', async () => {
    const incident = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Corte de agua en el ala norte',
      description: 'Sin suministro en seis habitaciones ocupadas.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      tags: [],
      requiresFollowUp: false,
    });

    await runAlertEngine();
    const alert = await prisma.alert.findFirstOrThrow({
      where: { entryId: incident.id, type: AlertType.INCIDENCIA_CRITICA },
    });
    expect(alert.level).toBe(AlertLevel.CRITICA);

    await changeEntryStatus(user, {
      id: incident.id,
      status: EntryStatus.CERRADO,
      resolution: 'Suministro restablecido.',
    });
    await runAlertEngine();

    const closed = await prisma.alert.findFirstOrThrow({ where: { id: alert.id } });
    expect(closed.status).toBe(AlertStatus.RESUELTA);
  });

  it('alerta por mantenimiento sin resolver pasadas 24 horas', async () => {
    await createEntry(user, {
      type: EntryType.MANTENIMIENTO,
      title: 'Luminaria intermitente en el piso 2',
      description: 'Pendiente recambio del balastro.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
      occurredAt: hoursAgo(30),
    });

    await runAlertEngine();
    expect(
      await prisma.alert.count({ where: { type: AlertType.MANTENIMIENTO_SIN_RESOLVER } }),
    ).toBe(1);
  });

  it('no alerta por mantenimiento reciente', async () => {
    await createEntry(user, {
      type: EntryType.MANTENIMIENTO,
      title: 'Grifo suelto en la 210',
      description: 'Reportado hace un rato.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
      occurredAt: hoursAgo(2),
    });

    await runAlertEngine();
    expect(
      await prisma.alert.count({ where: { type: AlertType.MANTENIMIENTO_SIN_RESOLVER } }),
    ).toBe(0);
  });

  it('marca el seguimiento como vencido y genera su alerta', async () => {
    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Registro con seguimiento programado',
      description: 'El seguimiento quedó con fecha pasada.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });
    const followUp = await createFollowUp(user, {
      entryId: entry.id,
      action: 'Reintentar contacto con el huésped.',
      scheduledAt: hoursAgo(5),
    });

    await runAlertEngine();

    const stored = await prisma.followUp.findUniqueOrThrow({ where: { id: followUp.id } });
    expect(stored.status).toBe('VENCIDO');
    expect(
      await prisma.alert.count({
        where: { followUpId: followUp.id, type: AlertType.SEGUIMIENTO_VENCIDO },
      }),
    ).toBe(1);
  });

  it('cubre garantías, cobros, reservas sin confirmar y llegadas VIP', async () => {
    const guest = await prisma.guestReference.create({
      data: { fullName: 'Helen Whitaker', roomNumber: '318', vip: true },
    });
    const today = new Date();

    await prisma.reservationReference.create({
      data: {
        code: 'RES-90001',
        guestId: guest.id,
        status: ReservationStatus.PENDIENTE,
        guaranteeStatus: GuaranteeStatus.PENDIENTE,
        balanceDue: 120000,
        checkIn: today,
        requiresAction: true,
        actionNote: 'Confirmar traslado.',
      },
    });
    await prisma.reservationReference.create({
      data: {
        code: 'RES-90002',
        status: ReservationStatus.EN_CASA,
        guaranteeStatus: GuaranteeStatus.RECHAZADA,
      },
    });

    await runAlertEngine();
    const types = (await prisma.alert.findMany({ select: { type: true } })).map((a) => a.type);

    expect(types).toContain(AlertType.GARANTIA_PENDIENTE);
    expect(types).toContain(AlertType.PAGO_PENDIENTE);
    expect(types).toContain(AlertType.RESERVA_SIN_CONFIRMAR);
    expect(types).toContain(AlertType.HUESPED_VIP);
    expect(types).toContain(AlertType.TRASLADO_PENDIENTE);
    expect(types).toContain(AlertType.TARJETA_INVALIDA);
  });

  it('no toca las alertas manuales', async () => {
    const manual = await createManualAlert(user, {
      type: AlertType.SALIDA_ANTICIPADA,
      level: AlertLevel.ATENCION,
      title: 'Salida anticipada del grupo a las 06:00',
    });

    await runAlertEngine();

    const stored = await prisma.alert.findUniqueOrThrow({ where: { id: manual.id } });
    expect(stored.status).toBe(AlertStatus.NUEVA);
    expect(stored.auto).toBe(false);
  });
});

describe('gestión de alertas', () => {
  let user: CurrentUser;
  let admin: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
  });

  const nueva = {
    type: AlertType.PAGO_PENDIENTE,
    level: AlertLevel.ATENCION,
    title: 'Saldo pendiente en la habitación 215',
  };

  it('se puede marcar como vista', async () => {
    const alert = await createManualAlert(user, nueva);
    const seen = await acknowledgeAlert(user, alert.id);

    expect(seen.status).toBe(AlertStatus.VISTA);
    expect(seen.acknowledgedById).toBe(user.id);
    expect(seen.acknowledgedAt).not.toBeNull();
  });

  it('se puede posponer y deja de contarse hasta que expira', async () => {
    const alert = await createManualAlert(user, nueva);
    expect(await countLiveAlerts()).toBe(1);

    const snoozed = await snoozeAlert(user, { id: alert.id, snoozeMinutes: 120 });
    expect(snoozed.status).toBe(AlertStatus.POSPUESTA);
    expect(snoozed.snoozedUntil).not.toBeNull();
    expect(await countLiveAlerts()).toBe(0);

    // Cuando el plazo vence, vuelve a estar viva.
    await prisma.alert.update({
      where: { id: alert.id },
      data: { snoozedUntil: hoursAgo(1) },
    });
    expect(await countLiveAlerts()).toBe(1);
  });

  it('se puede resolver con nota y queda auditada', async () => {
    const alert = await createManualAlert(user, nueva);
    const resolved = await resolveAlert(user, {
      id: alert.id,
      note: 'El huésped pagó en efectivo.',
    });

    expect(resolved.status).toBe(AlertStatus.RESUELTA);
    expect(resolved.resolvedById).toBe(user.id);
    expect(resolved.resolutionNote).toContain('efectivo');
    expect(await countLiveAlerts()).toBe(0);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: alert.id, action: 'CERRAR' },
    });
    expect(log).not.toBeNull();
  });

  it('una alerta resuelta no admite marcarse como vista ni posponerse', async () => {
    const alert = await createManualAlert(user, nueva);
    await resolveAlert(user, { id: alert.id });

    await expect(acknowledgeAlert(user, alert.id)).rejects.toThrow(/ya está resuelta/);
    await expect(snoozeAlert(user, { id: alert.id })).rejects.toThrow(/ya está resuelta/);
  });

  it('se elimina lógicamente y se restaura', async () => {
    const alert = await createManualAlert(user, nueva);

    await softDeleteAlert(admin, { id: alert.id, reason: 'Alerta creada por error.' });
    const deleted = await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(deleted.deletedAt).not.toBeNull();
    expect(await countLiveAlerts()).toBe(0);

    const restored = await restoreAlert(admin, { id: alert.id });
    expect(restored.deletedAt).toBeNull();
    expect(await countLiveAlerts()).toBe(1);
  });
});
