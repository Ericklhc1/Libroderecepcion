import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority, Severity, TaskStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  assignTask,
  changeTaskStatus,
  createTask,
  listMyTasks,
  restoreTask,
  softDeleteTask,
  toggleChecklistItem,
  updateTask,
} from '@/server/services/tasks';
import { createEntry } from '@/server/services/entries';
import { NotFoundError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

describe('tareas', () => {
  let receptionist: CurrentUser;
  let other: CurrentUser;
  let supervisor: CurrentUser;
  let admin: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción tarde' });
    other = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción mañana' });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
  });

  const base = {
    title: 'Confirmar traslado al aeropuerto',
    priority: Priority.ALTA,
    tags: [] as string[],
    checklist: [] as string[],
  };

  it('crea la tarea con numeración, origen manual y auditoría', async () => {
    const task = await createTask(receptionist, base);

    expect(task.seq).toBeGreaterThan(0);
    expect(task.origin).toBe('MANUAL');
    expect(task.status).toBe(TaskStatus.PENDIENTE);
    expect(task.createdById).toBe(receptionist.id);

    const log = await prisma.auditLog.findFirst({
      where: { entity: 'Task', entityId: task.id, action: 'CREAR' },
    });
    expect(log).not.toBeNull();
  });

  it('deduce el origen desde el registro que la motiva', async () => {
    const novedad = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Faltan toallas de piscina',
      description: 'Quedan catorce unidades en bodega.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
    });
    const incident = await createEntry(receptionist, {
      type: EntryType.INCIDENCIA,
      title: 'Tarjeta rechazada en la 215',
      description: 'La pre-autorización fue rechazada.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      tags: [],
      requiresFollowUp: false,
    });

    const fromEntry = await createTask(receptionist, { ...base, entryId: novedad.id });
    const fromIncident = await createTask(receptionist, { ...base, entryId: incident.id });

    expect(fromEntry.origin).toBe('REGISTRO');
    expect(fromIncident.origin).toBe('INCIDENCIA');
  });

  it('rechaza vincular la tarea a un registro inexistente', async () => {
    await expect(
      createTask(receptionist, { ...base, entryId: 'no-existe' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('crea el checklist en orden y permite marcarlo', async () => {
    const task = await createTask(receptionist, {
      ...base,
      checklist: ['Llamar a la empresa', 'Registrar patente', 'Informar al huésped'],
    });

    expect(task.checklist.map((item) => item.text)).toEqual([
      'Llamar a la empresa',
      'Registrar patente',
      'Informar al huésped',
    ]);
    expect(task.checklist.every((item) => !item.done)).toBe(true);

    const first = task.checklist[0]!;
    const marked = await toggleChecklistItem(receptionist, { itemId: first.id, done: true });
    expect(marked.done).toBe(true);
    expect(marked.doneById).toBe(receptionist.id);
    expect(marked.doneAt).not.toBeNull();

    const unmarked = await toggleChecklistItem(receptionist, { itemId: first.id, done: false });
    expect(unmarked.done).toBe(false);
    expect(unmarked.doneById).toBeNull();
  });

  it('notifica al asignado y registra la reasignación', async () => {
    const task = await createTask(supervisor, { ...base, assigneeId: receptionist.id });
    expect(
      await prisma.notification.count({
        where: { userId: receptionist.id, type: 'TAREA_ASIGNADA' },
      }),
    ).toBe(1);

    await assignTask(supervisor, {
      id: task.id,
      assigneeId: other.id,
      reason: 'Cambio de turno.',
    });

    const log = await prisma.auditLog.findFirst({
      where: { entityId: task.id, action: 'CAMBIO_RESPONSABLE' },
    });
    expect(log?.reason).toBe('Cambio de turno.');

    // El nuevo responsable es avisado y el anterior también.
    expect(
      await prisma.notification.count({ where: { userId: other.id, type: 'TAREA_ASIGNADA' } }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { userId: receptionist.id, type: 'RESPONSABLE_CAMBIADO' },
      }),
    ).toBe(1);
  });

  it('no permite asignar a alguien fuera de la operación', async () => {
    const task = await createTask(supervisor, base);
    await expect(
      assignTask(supervisor, { id: task.id, assigneeId: admin.id }),
    ).rejects.toThrow(/fuera de la operación/);
  });

  it('respeta las transiciones válidas de estado', async () => {
    const task = await createTask(receptionist, base);

    const inProgress = await changeTaskStatus(receptionist, {
      id: task.id,
      status: TaskStatus.EN_CURSO,
    });
    expect(inProgress.status).toBe(TaskStatus.EN_CURSO);

    const completed = await changeTaskStatus(receptionist, {
      id: task.id,
      status: TaskStatus.COMPLETADA,
    });
    expect(completed.status).toBe(TaskStatus.COMPLETADA);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.completedById).toBe(receptionist.id);

    // Desde COMPLETADA sólo se puede volver a EN_CURSO.
    await expect(
      changeTaskStatus(receptionist, { id: task.id, status: TaskStatus.PENDIENTE }),
    ).rejects.toThrow(/No puedes pasar una tarea de Completada a Pendiente/);
  });

  it('exige motivo al bloquear una tarea y lo limpia al desbloquear', async () => {
    const task = await createTask(receptionist, base);

    await expect(
      changeTaskStatus(receptionist, { id: task.id, status: TaskStatus.BLOQUEADA }),
    ).rejects.toThrow(/Indica por qué la tarea queda bloqueada/);

    const blocked = await changeTaskStatus(receptionist, {
      id: task.id,
      status: TaskStatus.BLOQUEADA,
      blockedReason: 'Falta el repuesto del proveedor.',
    });
    expect(blocked.blockedReason).toContain('repuesto');

    const resumed = await changeTaskStatus(receptionist, {
      id: task.id,
      status: TaskStatus.EN_CURSO,
    });
    expect(resumed.blockedReason).toBeNull();
  });

  it('una tarea completada o cancelada no admite edición', async () => {
    const task = await createTask(receptionist, base);
    await changeTaskStatus(receptionist, { id: task.id, status: TaskStatus.CANCELADA });

    await expect(
      updateTask(receptionist, { id: task.id, title: 'Otro título' }),
    ).rejects.toThrow(/no admite edición/);
  });

  it('lista las tareas propias abiertas ordenadas por urgencia', async () => {
    const soon = new Date(Date.now() + 3600_000);
    const later = new Date(Date.now() + 7 * 3600_000);

    await createTask(supervisor, {
      ...base,
      title: 'Tarea con vencimiento lejano',
      assigneeId: receptionist.id,
      dueAt: later,
    });
    await createTask(supervisor, {
      ...base,
      title: 'Tarea con vencimiento próximo',
      assigneeId: receptionist.id,
      dueAt: soon,
    });
    const done = await createTask(supervisor, {
      ...base,
      title: 'Tarea ya completada',
      assigneeId: receptionist.id,
    });
    await changeTaskStatus(supervisor, { id: done.id, status: TaskStatus.COMPLETADA });
    await createTask(supervisor, { ...base, title: 'Tarea de otra persona', assigneeId: other.id });

    const mine = await listMyTasks(receptionist.id);
    expect(mine.map((task) => task.title)).toEqual([
      'Tarea con vencimiento próximo',
      'Tarea con vencimiento lejano',
    ]);
  });

  it('elimina lógicamente y restaura con trazabilidad', async () => {
    const task = await createTask(receptionist, base);

    await softDeleteTask(supervisor, { id: task.id, reason: 'Creada por duplicado.' });
    const deleted = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.deletedById).toBe(supervisor.id);

    await expect(
      changeTaskStatus(receptionist, { id: task.id, status: TaskStatus.EN_CURSO }),
    ).rejects.toThrow(NotFoundError);

    const restored = await restoreTask(admin, { id: task.id });
    expect(restored.deletedAt).toBeNull();

    const actions = await prisma.auditLog.findMany({
      where: { entityId: task.id },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toContain('ELIMINAR');
    expect(actions.map((a) => a.action)).toContain('RESTAURAR');
  });
});
