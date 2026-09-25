import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditDisclosure,
  CorrectiveMeasureStatus,
  EntryStatus,
  Priority,
  SupervisionVisibility,
  TaskStatus,
  TaskTargetType,
} from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  createSupervisionNote,
  deliverSupervisionShift,
  finishSupervisionShift,
  followSupervisionSource,
  getSupervisionCenterSummary,
  listVisibleSupervisionNotes,
  readSupervisionNote,
  receiveSupervisionHandover,
  restoreSupervisionNote,
  softDeleteSupervisionNote,
  startSupervisionShift,
} from '@/server/services/supervision-center';
import { createTask, changeTaskStatus } from '@/server/services/tasks';
import { changeEntryStatus } from '@/server/services/entries';
import { createFollowUp } from '@/server/services/followups';
import {
  finishRun,
  listRuns,
  markRunItem,
  saveTemplate,
  startRun,
} from '@/server/services/checklists';
import {
  changeCorrectiveMeasureStatus,
  createCorrectiveMeasureFromFinding,
  restoreCorrectiveMeasure,
  softDeleteCorrectiveMeasure,
} from '@/server/services/corrective-measures';
import { getTeamPerformance, getUserPerformance } from '@/server/services/performance';
import { listOperationalUsers } from '@/server/services/users';

describe('Centro de Supervisión', () => {
  let supervisor: CurrentUser;
  let nextSupervisor: CurrentUser;
  let receptionist: CurrentUser;
  let collaborator: CurrentUser;
  let admin: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisora Ana' });
    nextSupervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisor Bruno' });
    receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepcionista Carla' });
    collaborator = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepcionista Diego' });
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador técnico' });
  });

  it('carga seguimientos privados del Supervisor sin error de ejecución', async () => {
    await startSupervisionShift(supervisor, { priorities: ['Seguimiento privado'] });
    const followUp = await createFollowUp(supervisor, {
      action: 'Revisar diferencia de Caja',
      description: 'Seguimiento reservado para Supervisión.',
      ownerId: supervisor.id,
      visibility: SupervisionVisibility.PRIVADO,
    });

    const summary = await getSupervisionCenterSummary(supervisor);

    expect(summary.followUps.map((item) => item.id)).toContain(followUp.id);
    expect(summary.followUps.find((item) => item.id === followUp.id)?.visibility).toBe(
      SupervisionVisibility.PRIVADO,
    );
  });

  it('mantiene la continuidad personal aunque el turno de Supervisión se cierre', async () => {
    const shift = await startSupervisionShift(supervisor, { priorities: ['Resolver pendientes'] });
    const followUp = await createFollowUp(supervisor, {
      action: 'Confirmar respuesta pendiente',
      ownerId: supervisor.id,
      visibility: SupervisionVisibility.SUPERVISION,
    });

    await finishSupervisionShift(supervisor, shift.id);

    const persisted = await prisma.followUp.findUniqueOrThrow({ where: { id: followUp.id } });
    expect(persisted.status).toBe('PENDIENTE');
    expect(persisted.completedAt).toBeNull();

    await startSupervisionShift(supervisor, { priorities: [] });
    const summary = await getSupervisionCenterSummary(supervisor);
    expect(summary.lastClosedShift?.id).toBe(shift.id);
    expect(summary.myFollowUps.map((item) => item.id)).toContain(followUp.id);
  });

  it('permite seguir una fuente real sin duplicarla y evita seguimientos repetidos', async () => {
    const entry = await prisma.operationalEntry.create({
      data: {
        type: 'NOVEDAD',
        title: 'Pendiente que merece vigilancia',
        description: 'Recepción continúa siendo responsable del registro.',
        createdById: receptionist.id,
      },
    });

    const first = await followSupervisionSource(supervisor, {
      sourceEntity: 'OperationalEntry',
      sourceId: entry.id,
    });
    const second = await followSupervisionSource(supervisor, {
      sourceEntity: 'OperationalEntry',
      sourceId: entry.id,
    });

    expect(second.id).toBe(first.id);
    expect(first.entryId).toBe(entry.id);
    expect(first.sourceEntity).toBe('OperationalEntry');
    expect(first.sourceId).toBe(entry.id);
    expect(await prisma.operationalEntry.count({ where: { id: entry.id } })).toBe(1);
  });

  it('resolver la fuente cierra automáticamente el seguimiento técnico de Supervisión', async () => {
    const entry = await prisma.operationalEntry.create({
      data: {
        type: 'NOVEDAD',
        title: 'Fuente que se resolverá una sola vez',
        description: 'Seguir no debe crear una segunda obligación de cierre.',
        createdById: receptionist.id,
      },
    });
    const followUp = await followSupervisionSource(supervisor, {
      sourceEntity: 'OperationalEntry',
      sourceId: entry.id,
    });

    await changeEntryStatus(supervisor, {
      id: entry.id,
      status: EntryStatus.RESUELTO,
      resolution: 'La novedad quedó resuelta en su fuente.',
    });

    const persisted = await prisma.followUp.findUniqueOrThrow({ where: { id: followUp.id } });
    expect(persisted.status).toBe('CUMPLIDO');
    expect(persisted.completedAt).not.toBeNull();
    expect(persisted.result).toContain('fuente de origen');
  });

  it('reserva la operación al Supervisor y excluye al Administrador de asignaciones', async () => {
    expect(supervisor.permissions).toContain('supervision.center.view');
    expect(supervisor.permissions).toContain('supervision.shift.manage');
    expect(receptionist.permissions).not.toContain('supervision.center.view');

    await expect(startSupervisionShift(receptionist, { priorities: [] })).rejects.toThrow(
      /sólo puede ser operado por el rol Supervisor/,
    );
    await expect(startSupervisionShift(admin, { priorities: [] })).rejects.toThrow(
      /sólo puede ser operado por el rol Supervisor/,
    );

    const assignable = await listOperationalUsers();
    expect(assignable.map((person) => person.id)).not.toContain(admin.id);
    await expect(
      createTask(supervisor, {
        title: 'Tarea improcedente',
        priority: Priority.MEDIA,
        assigneeId: admin.id,
        tags: [],
        checklist: [],
      }),
    ).rejects.toThrow(/fuera de la operación/);
    const teamTask = await createTask(supervisor, {
      title: 'Tarea para el equipo operativo',
      priority: Priority.MEDIA,
      targetType: TaskTargetType.EQUIPO,
      tags: [],
      checklist: [],
    });
    expect(teamTask.participants.map((participant) => participant.userId)).not.toContain(admin.id);
  });

  it('mantiene turnos de Supervisión simultáneos e independientes de Recepción', async () => {
    const first = await startSupervisionShift(supervisor, { priorities: ['Validar cierres'] });
    const second = await startSupervisionShift(nextSupervisor, { priorities: ['Revisar alertas'] });
    expect(first.id).not.toBe(second.id);
    await expect(startSupervisionShift(supervisor, { priorities: [] })).rejects.toThrow(
      /Ya tienes un turno de Supervisión abierto/,
    );

    const receptionShift = await openShiftAs(supervisor);
    const handover = await deliverSupervisionShift(supervisor, {
      shiftId: first.id,
      note: 'Continuar con el cierre nocturno.',
    });
    await finishSupervisionShift(supervisor, first.id);

    const stillOpen = await prisma.shift.findUniqueOrThrow({ where: { id: receptionShift.id } });
    expect(['INICIADO', 'ACTIVO']).toContain(stillOpen.status);
    expect((handover.snapshot as { shift: { id: string } }).shift.id).toBe(first.id);

    const received = await receiveSupervisionHandover(nextSupervisor, handover.id);
    expect(received.receivedById).toBe(nextSupervisor.id);
    expect(received.receivedAt).not.toBeNull();
  });

  it('crea asignaciones múltiples y exige devolución y validación explícitas', async () => {
    await startSupervisionShift(supervisor, { priorities: ['Coordinar al equipo'] });
    const task = await createTask(supervisor, {
      title: 'Verificar garantías pendientes',
      description: 'Contrastar comprobantes con el PMS.',
      fulfillmentCriteria: 'Todos los folios quedan conciliados.',
      evidenceRequired: 'Folio de conciliación',
      assigneeId: receptionist.id,
      collaboratorIds: [collaborator.id],
      targetType: TaskTargetType.MULTIPLES,
      priority: Priority.ALTA,
      dueAt: new Date(Date.now() + 86_400_000),
      tags: ['garantías'],
      checklist: [],
    });
    expect(task.participants).toHaveLength(2);

    const done = await changeTaskStatus(receptionist, {
      id: task.id,
      status: TaskStatus.REALIZADA,
      evidenceProvided: 'Folio CON-104',
    });
    expect(done.status).toBe(TaskStatus.REALIZADA);
    expect(done.validatedAt).toBeNull();

    const returned = await changeTaskStatus(supervisor, {
      id: task.id,
      status: TaskStatus.DEVUELTA,
      reason: 'Falta contrastar el comprobante 08.',
    });
    expect(returned.returnReason).toContain('comprobante 08');
    await changeTaskStatus(receptionist, { id: task.id, status: TaskStatus.REALIZADA });
    const validated = await changeTaskStatus(supervisor, {
      id: task.id,
      status: TaskStatus.VALIDADA,
    });
    expect(validated.validatedById).toBe(supervisor.id);

    const history = await prisma.auditLog.findMany({ where: { entity: 'Task', entityId: task.id } });
    expect(history.some((row) => row.summary.includes('Devuelta'))).toBe(true);
    expect(history.some((row) => row.summary.includes('Validada'))).toBe(true);
  });

  it('protege las notas privadas y audita el acceso técnico excepcional', async () => {
    const privateNote = await createSupervisionNote(supervisor, {
      title: 'Decisión reservada',
      body: 'Contexto que sólo debe ver su autora.',
      visibility: SupervisionVisibility.PRIVADO,
    });
    await createSupervisionNote(supervisor, {
      title: 'Relevo compartido',
      body: 'Revisar el cierre pendiente.',
      visibility: SupervisionVisibility.SUPERVISION,
    });

    const visibleToNext = await listVisibleSupervisionNotes(nextSupervisor);
    expect(visibleToNext.map((note) => note.id)).not.toContain(privateNote.id);
    expect(visibleToNext.some((note) => note.title === 'Relevo compartido')).toBe(true);
    await expect(listVisibleSupervisionNotes(receptionist)).rejects.toThrow(/no forman parte/);
    await expect(readSupervisionNote(nextSupervisor, privateNote.id)).rejects.toThrow(/privada/);

    await readSupervisionNote(admin, privateNote.id);
    expect(
      await prisma.auditLog.count({
        where: {
          entity: 'SupervisionNote',
          entityId: privateNote.id,
          userId: admin.id,
          summary: { contains: 'Acceso técnico excepcional' },
        },
      }),
    ).toBe(1);

    await softDeleteSupervisionNote(supervisor, { id: privateNote.id, reason: 'Archivada por error.' });
    expect((await prisma.supervisionNote.findUniqueOrThrow({ where: { id: privateNote.id } })).deletedAt).not.toBeNull();
    await restoreSupervisionNote(admin, privateNote.id);
    expect((await prisma.supervisionNote.findUniqueOrThrow({ where: { id: privateNote.id } })).deletedAt).toBeNull();
  });

  it('transfiere seguimientos dentro de una copia de entrega inalterable', async () => {
    const shift = await startSupervisionShift(supervisor, { priorities: ['Resolver pendientes'] });
    const followUp = await createFollowUp(supervisor, {
      action: 'Confirmar respuesta del proveedor',
      description: 'Esperar folio y revisar condiciones.',
      ownerId: receptionist.id,
      priority: Priority.ALTA,
      visibility: SupervisionVisibility.SUPERVISION,
      scheduledAt: new Date(Date.now() + 3_600_000),
    });
    const handover = await deliverSupervisionShift(supervisor, { shiftId: shift.id });
    const snapshot = handover.snapshot as { followUps: Array<{ id: string; action: string }> };
    expect(snapshot.followUps).toContainEqual(
      expect.objectContaining({ id: followUp.id, action: followUp.action }),
    );

    await prisma.followUp.update({ where: { id: followUp.id }, data: { action: 'Texto modificado después' } });
    const persisted = await prisma.supervisionShiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect((persisted.snapshot as { followUps: Array<{ action: string }> }).followUps[0]?.action).toBe(
      'Confirmar respuesta del proveedor',
    );
    await expect(
      prisma.supervisionShiftHandover.update({
        where: { id: handover.id },
        data: { snapshot: { version: 999 } },
      }),
    ).rejects.toThrow(/inalterable/);
  });

  it('cierra auditorías sorpresa y convierte hallazgos en medidas correctivas recuperables', async () => {
    await startSupervisionShift(supervisor, { priorities: ['Auditar caja'] });
    const template = await saveTemplate(supervisor, {
      name: 'Caja y movimientos',
      category: 'CAJA_MOVIMIENTOS',
      items: ['*Saldo coincide con el comprobante', 'Movimientos con respaldo'],
    });
    const run = await startRun(supervisor, {
      templateId: template.id,
      scope: 'Turno diurno del día',
      sample: 'Cinco movimientos elegidos al azar',
      participantIds: [receptionist.id],
    });
    expect(run.status).toBe('PREPARACION');
    expect((await listRuns(nextSupervisor)).map((item) => item.id)).not.toContain(run.id);
    expect((await listRuns(admin)).map((item) => item.id)).toContain(run.id);

    await markRunItem(supervisor, {
      itemId: run.items[0]!.id,
      result: 'INCUMPLIMIENTO',
      observation: 'El comprobante 18 no coincide.',
      evidence: 'Movimiento M-18',
      severity: 'ALTA',
    });
    await markRunItem(supervisor, { itemId: run.items[1]!.id, result: 'CUMPLE' });
    await finishRun(supervisor, {
      runId: run.id,
      resultSummary: 'Un incumplimiento confirmado.',
      disclosure: AuditDisclosure.RESERVADO,
    });
    const finding = await prisma.auditFinding.findFirstOrThrow({ where: { auditId: run.id } });
    expect(finding.confirmed).toBe(true);
    const auditHistory = await prisma.auditLog.findMany({ where: { entity: 'ChecklistRun', entityId: run.id } });
    expect(auditHistory.map((row) => row.action)).toEqual(
      expect.arrayContaining(['CREAR', 'EDITAR', 'CERRAR']),
    );

    const measure = await createCorrectiveMeasureFromFinding(supervisor, {
      findingId: finding.id,
      title: 'Corregir conciliación M-18',
      action: 'Rehacer la conciliación y adjuntar comprobante.',
      assigneeId: receptionist.id,
      evidenceRequired: 'Comprobante conciliado',
    });
    await changeCorrectiveMeasureStatus(supervisor, {
      id: measure.id,
      status: CorrectiveMeasureStatus.REALIZADA,
      evidence: 'Comprobante C-18',
    });
    const validated = await changeCorrectiveMeasureStatus(supervisor, {
      id: measure.id,
      status: CorrectiveMeasureStatus.VALIDADA,
      evidence: 'Revisado contra caja',
    });
    expect(validated.validatedById).toBe(supervisor.id);

    await softDeleteCorrectiveMeasure(supervisor, { id: measure.id, reason: 'Prueba de recuperación.' });
    await restoreCorrectiveMeasure(admin, measure.id);
    expect((await prisma.correctiveMeasure.findUniqueOrThrow({ where: { id: measure.id } })).deletedAt).toBeNull();
  });

  it('calcula indicadores explicables y bloquea la consulta entre recepcionistas', async () => {
    await startSupervisionShift(supervisor, { priorities: ['Revisar cumplimiento'] });
    const task = await createTask(supervisor, {
      title: 'Preparar entrega de llaves',
      priority: Priority.MEDIA,
      assigneeId: receptionist.id,
      dueAt: new Date(Date.now() + 86_400_000),
      tags: [],
      checklist: [],
    });
    await changeTaskStatus(receptionist, { id: task.id, status: TaskStatus.REALIZADA });
    await changeTaskStatus(supervisor, { id: task.id, status: TaskStatus.VALIDADA });

    const period = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const report = await getUserPerformance(supervisor, receptionist.id, period);
    const completion = report.indicators.find((indicator) => indicator.key === 'task-completion');
    expect(completion).toMatchObject({ numerator: 1, denominator: 1, value: 100 });
    expect(completion?.formula).toContain('÷');
    expect(completion?.source).toBeTruthy();
    expect(completion?.cases[0]?.href).toBe(`/tareas/${task.id}`);

    await expect(getTeamPerformance(receptionist, period)).rejects.toThrow(/No tienes permiso/);
    await expect(getUserPerformance(receptionist, collaborator.id, period)).rejects.toThrow(
      /No tienes permiso/,
    );
  });

  it('mantiene navegación y rejillas adaptables en el Centro', async () => {
    const [page, nav] = await Promise.all([
      readFile('src/app/(app)/supervision/page.tsx', 'utf8'),
      readFile('src/components/layout/nav-items.ts', 'utf8'),
    ]);
    expect(nav).toContain('Centro de Supervisión');
    expect(page).toContain('sm:grid-cols-2');
    expect(page).toContain('lg:grid-cols-2');
    expect(page).toContain('flex flex-wrap');
    expect(page).toContain('CardScroll');
    expect(page).toContain('Desde tu último turno');
    expect(page).toContain('Asignado a mí');
    expect(page).toContain('En seguimiento');
    expect(page).toContain('href="#continuidad"');
    expect(page).toContain('href="#pendientes"');
    expect(page).toContain('href="#seguimientos"');
    expect(page).toContain('href="#senales"');
    expect(page).toContain('Requiere atención · señales del Libro');
    expect(page).toContain('FollowSupervisionSourceForm');
    expect(page).toContain('StopFollowingSupervisionForm');
    expect(page).not.toContain('Entregas de Supervisión pendientes de recibir');
  });
});
