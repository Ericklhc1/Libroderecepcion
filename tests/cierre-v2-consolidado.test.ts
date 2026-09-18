import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertStatus, Priority, ShiftStatus, ShiftType, TaskStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  prepareHandover,
  receiveHandover,
  sendHandover,
} from '@/server/services/shifts';
import {
  resolveAlert,
  returnClosureValidation,
} from '@/server/services/alerts';
import type { CurrentUser } from '@/server/auth/current-user';

describe('Cierre Operativo V2 consolidado', () => {
  let outgoing: CurrentUser;
  let incoming: CurrentUser;
  let erick: CurrentUser;
  let otherSupervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    outgoing = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      username: 'SalidaV2',
      name: 'Recepción saliente',
    });
    incoming = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      username: 'EntradaV2',
      name: 'Recepción entrante',
    });
    erick = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      username: 'EHerrera',
      name: 'Erick Herrera',
    });
    otherSupervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      username: 'SupervisorV2',
      name: 'Otro Supervisor',
    });
  });

  async function completeHandover() {
    const shiftA = await openShiftAs(outgoing, { type: ShiftType.DIA });
    await receiveHandover(outgoing, { shiftId: shiftA.id });
    await prepareHandover(outgoing, shiftA.id);
    const handover = await sendHandover(outgoing, { shiftId: shiftA.id });

    const shiftB = await openShiftAs(incoming, { type: ShiftType.NOCHE });
    await receiveHandover(incoming, {
      shiftId: shiftB.id,
      handoverId: handover.id,
    });

    return { shiftA, shiftB, handover };
  }

  it('Recibir cierra atómicamente el turno saliente con hora real', async () => {
    const { shiftA, shiftB } = await completeHandover();

    const [closed, active] = await Promise.all([
      prisma.shift.findUniqueOrThrow({ where: { id: shiftA.id } }),
      prisma.shift.findUniqueOrThrow({ where: { id: shiftB.id } }),
    ]);

    expect(closed.status).toBe(ShiftStatus.CERRADO);
    expect(closed.actualEnd).not.toBeNull();
    expect(closed.closedById).toBe(incoming.id);
    expect(active.status).toBe(ShiftStatus.ACTIVO);
  });

  it('todo cierre crea validación y tarea ALTA asignada a EHerrera', async () => {
    const { shiftA } = await completeHandover();

    const alert = await prisma.alert.findUniqueOrThrow({
      where: { dedupeKey: `shift-validation:${shiftA.id}` },
    });
    expect(alert.status).toBe(AlertStatus.NUEVA);

    const task = await prisma.task.findFirstOrThrow({
      where: { alertId: alert.id, deletedAt: null },
    });
    expect(task.assigneeId).toBe(erick.id);
    expect(task.priority).toBe(Priority.ALTA);
    expect(task.status).toBe(TaskStatus.PENDIENTE);
  });

  it('ningún otro Supervisor puede validar el cierre asignado a Erick', async () => {
    const { shiftA } = await completeHandover();
    const alert = await prisma.alert.findUniqueOrThrow({
      where: { dedupeKey: `shift-validation:${shiftA.id}` },
    });

    await expect(
      resolveAlert(otherSupervisor, { id: alert.id, note: 'Intento ajeno.' }),
    ).rejects.toThrow(/Erick Herrera/);

    const validated = await resolveAlert(erick, {
      id: alert.id,
      note: 'Cierre revisado y conforme.',
    });
    expect(validated.status).toBe(AlertStatus.RESUELTA);

    const task = await prisma.task.findFirstOrThrow({ where: { alertId: alert.id } });
    expect(task.status).toBe(TaskStatus.COMPLETADA);
    expect(task.completedById).toBe(erick.id);
  });

  it('Erick puede devolver el cierre con observación y la validación sigue abierta', async () => {
    const { shiftA } = await completeHandover();
    const alert = await prisma.alert.findUniqueOrThrow({
      where: { dedupeKey: `shift-validation:${shiftA.id}` },
    });

    await expect(
      returnClosureValidation(erick, { id: alert.id, note: ' ' }),
    ).rejects.toThrow(/observación/i);

    const returned = await returnClosureValidation(erick, {
      id: alert.id,
      note: 'Revisar conciliación PMS antes de validar.',
    });

    expect(returned.status).toBe(AlertStatus.VISTA);
    expect(returned.resolvedAt).toBeNull();
    expect(returned.resolutionNote).toContain('Devuelto para corrección');

    const task = await prisma.task.findFirstOrThrow({ where: { alertId: alert.id } });
    expect(task.status).toBe(TaskStatus.PENDIENTE);
    expect(task.completedAt).toBeNull();
  });
});
