import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryStatus, EntryType, Priority, Severity, ShiftType, TaskStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { buildHandoverSnapshot } from '@/server/services/handover-snapshot';
import { createEntry, changeEntryStatus } from '@/server/services/entries';
import { createTask, changeTaskStatus } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import { receiveHandover } from '@/server/services/shifts';
import type { CurrentUser } from '@/server/auth/current-user';

describe('continuidad de la entrega de turno', () => {
  let user: CurrentUser;

  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
    user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });

  async function abrirTurno() {
    const shift = await openShiftAs(user, { type: ShiftType.DIA });
    await receiveHandover(user, { shiftId: shift.id });
    return prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
  }

  it('arrastra lo resuelto por el turno que está cerrando', async () => {
    const shift = await abrirTurno();
    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Tarjeta de acceso recuperada',
      description: 'El huésped devolvió la tarjeta que estaba pendiente.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });

    await changeEntryStatus(user, {
      id: entry.id,
      status: EntryStatus.CERRADO,
      resolution: 'Tarjeta recibida en recepción.',
    });

    const snapshot = await buildHandoverSnapshot(new Date(), { shiftId: shift.id });
    const resolved = snapshot.find(
      (item) => item.section === 'Resuelto en este turno' && item.refId === entry.id,
    );

    expect(resolved).toBeDefined();
    expect(resolved?.detail).toContain('Tarjeta recibida en recepción');
  });

  it('conserva tarea y seguimiento ligados al mismo caso con contexto explícito', async () => {
    await abrirTurno();
    const incident = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Garantía pendiente en la 415',
      description: 'Falta regularizar la garantía de la reserva.',
      priority: Priority.ALTA,
      severity: Severity.ALTA,
      tags: [],
      requiresFollowUp: true,
    });
    const task = await createTask(user, {
      title: 'Solicitar nueva tarjeta',
      entryId: incident.id,
      priority: Priority.ALTA,
      tags: [],
      checklist: [],
    });
    const followUp = await createFollowUp(user, {
      entryId: incident.id,
      action: 'Revisar respuesta de la huésped',
      scheduledAt: new Date(Date.now() + 60 * 60_000),
    });

    const snapshot = await buildHandoverSnapshot();
    const taskItem = snapshot.find((item) => item.refId === task.id);
    const followUpItem = snapshot.find((item) => item.refId === followUp.id);

    expect(taskItem?.detail).toContain(`Caso #${incident.seq}`);
    expect(followUpItem?.detail).toContain(`Caso #${incident.seq}`);
  });

  it('guarda ocupación y dólar como fotografía operativa de la entrega', async () => {
    const shift = await abrirTurno();
    await prisma.systemSetting.upsert({
      where: { key: 'reception.usdRateCLP' },
      create: {
        key: 'reception.usdRateCLP',
        value: 950,
        category: 'recepción',
      },
      update: { value: 950 },
    });

    const snapshot = await buildHandoverSnapshot(new Date(), {
      shiftId: shift.id,
      includeMetrics: true,
    });

    expect(
      snapshot.some((item) => item.refType === 'metric' && item.refId === 'occupancy'),
    ).toBe(true);
    expect(
      snapshot.some(
        (item) =>
          item.refType === 'metric' && item.refId === 'usd-rate' && item.title.includes('950'),
      ),
    ).toBe(true);
  });

  it('una tarea independiente completada durante el turno también queda informada', async () => {
    const shift = await abrirTurno();
    const task = await createTask(user, {
      title: 'Ordenar sobres de tesorería',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
    });
    await changeTaskStatus(user, { id: task.id, status: TaskStatus.COMPLETADA });

    const snapshot = await buildHandoverSnapshot(new Date(), { shiftId: shift.id });
    expect(
      snapshot.some(
        (item) => item.section === 'Resuelto en este turno' && item.refId === task.id,
      ),
    ).toBe(true);
  });
});
