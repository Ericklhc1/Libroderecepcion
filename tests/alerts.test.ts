import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  EntryType,
  Priority,
  Severity,
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
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import { followSupervisionSource } from '@/server/services/supervision-center';
import type { CurrentUser } from '@/server/auth/current-user';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);

describe('motor de señales legadas', () => {
  let user: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    user = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  it('una tarea vencida sigue siendo la misma tarea y no fabrica otra Alert', async () => {
    const task = await createTask(user, {
      title: 'Solicitar medio de pago alternativo',
      priority: Priority.ALTA,
      tags: [],
      checklist: [],
      dueAt: hoursAgo(3),
    });

    const result = await runAlertEngine();

    expect(result.created).toBe(0);
    expect(result.reopened).toBe(0);
    expect(await prisma.alert.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('una incidencia crítica permanece en Novedades sin duplicarse como Alert', async () => {
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

    expect(await prisma.alert.count({ where: { entryId: incident.id } })).toBe(0);
  });

  it('marca el seguimiento vencido sin crear una segunda entidad de alerta', async () => {
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
    expect(await prisma.alert.count({ where: { followUpId: followUp.id } })).toBe(0);
  });

  it('cierra señales automáticas legadas pero conserva las manuales para compatibilidad', async () => {
    const legacy = await prisma.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        status: AlertStatus.NUEVA,
        title: 'Señal automática histórica',
        dedupeKey: 'legacy:auto:test',
        auto: true,
      },
    });
    const manual = await createManualAlert(user, {
      type: AlertType.SALIDA_ANTICIPADA,
      level: AlertLevel.ATENCION,
      title: 'Validación manual de compatibilidad',
    });

    const result = await runAlertEngine();

    expect(result.created).toBe(0);
    expect(result.reopened).toBe(0);
    expect(result.resolved).toBe(1);
    expect((await prisma.alert.findUniqueOrThrow({ where: { id: legacy.id } })).status).toBe(
      AlertStatus.RESUELTA,
    );
    expect((await prisma.alert.findUniqueOrThrow({ where: { id: manual.id } })).status).toBe(
      AlertStatus.NUEVA,
    );
  });

  it('una garantía pendiente no se duplica en Alert', async () => {
    await prisma.guarantee.create({
      data: {
        kind: 'EFECTIVO',
        amount: 120000,
        currency: 'CLP',
        state: 'PENDIENTE',
        reference: 'GAR-90001',
        guestName: 'Helen Whitaker',
        roomNumber: '318',
        createdById: user.id,
      },
    });

    await runAlertEngine();

    expect(await prisma.alert.count({ where: { type: AlertType.GARANTIA_PENDIENTE } })).toBe(0);
  });
});

describe('gestión de alertas', () => {
  let user: CurrentUser;
  let supervisor: CurrentUser;
  let admin: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
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

  it('resolver una alerta cierra también su seguimiento técnico de Supervisión', async () => {
    const alert = await createManualAlert(user, nueva);
    const followUp = await followSupervisionSource(supervisor, {
      sourceEntity: 'Alert',
      sourceId: alert.id,
    });

    await resolveAlert(user, { id: alert.id, note: 'Fuente resuelta.' });

    const stored = await prisma.followUp.findUniqueOrThrow({ where: { id: followUp.id } });
    expect(stored.status).toBe('CUMPLIDO');
    expect(stored.completedAt).not.toBeNull();
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
