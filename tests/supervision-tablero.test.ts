import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Priority, Severity, TaskStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { getAssignmentBoard } from '@/server/services/assignment-board';
import {
  finishRun,
  getMyOpenRun,
  listTemplates,
  markRunItem,
  saveTemplate,
  softDeleteTemplate,
  startRun,
} from '@/server/services/checklists';
import { createTask } from '@/server/services/tasks';
import { createEntry } from '@/server/services/entries';
import { NotFoundError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

describe('tablero de asignación', () => {
  let supervisor: CurrentUser & { username: string };
  let recepcion: CurrentUser & { username: string };

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Ana Supervisora' });
    recepcion = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Beto Recepción' });
  });

  it('lo que no tiene responsable aparece, lo asignado no', async () => {
    const huerfana = await createTask(supervisor, {
      title: 'Nadie la tomó',
      priority: Priority.ALTA,
      checklist: [],
      tags: [],
    });
    await createTask(supervisor, {
      title: 'Ya tiene dueño',
      priority: Priority.ALTA,
      assigneeId: recepcion.id,
      checklist: [],
      tags: [],
    });

    const board = await getAssignmentBoard();
    const ids = board.unassigned.map((item) => item.id);

    expect(ids).toContain(huerfana.id);
    expect(board.unassigned).toHaveLength(1);
  });

  it('la carga de cada persona se cuenta, y es lo que el listado no muestra', async () => {
    for (let i = 0; i < 3; i += 1) {
      await createTask(supervisor, {
        title: `Pendiente ${i}`,
        priority: Priority.MEDIA,
        assigneeId: recepcion.id,
        checklist: [],
        tags: [],
      });
    }
    await createTask(supervisor, {
      title: 'Una del supervisor',
      priority: Priority.CRITICA,
      assigneeId: supervisor.id,
      checklist: [],
      tags: [],
    });

    const board = await getAssignmentBoard();
    const beto = board.workload.find((row) => row.userId === recepcion.id);
    const ana = board.workload.find((row) => row.userId === supervisor.id);

    expect(beto?.openTasks).toBe(3);
    expect(ana?.openTasks).toBe(1);
    // La crítica cuenta como urgente; las medias no.
    expect(ana?.urgent).toBe(1);
    expect(beto?.urgent).toBe(0);

    // De la más cargada a la menos: el Supervisor mira primero a quién aliviar.
    expect(board.workload[0]?.userId).toBe(recepcion.id);
  });

  it('cuenta las vencidas aparte de las abiertas', async () => {
    await createTask(supervisor, {
      title: 'Vencida',
      priority: Priority.MEDIA,
      assigneeId: recepcion.id,
      dueAt: new Date(Date.now() - 86_400_000),
      checklist: [],
      tags: [],
    });
    await createTask(supervisor, {
      title: 'Al día',
      priority: Priority.MEDIA,
      assigneeId: recepcion.id,
      dueAt: new Date(Date.now() + 86_400_000),
      checklist: [],
      tags: [],
    });

    const board = await getAssignmentBoard();
    const beto = board.workload.find((row) => row.userId === recepcion.id);
    expect(beto?.openTasks).toBe(2);
    expect(beto?.overdueTasks).toBe(1);
    expect(board.overdueTotal).toBe(1);
  });

  it('una tarea completada deja de contar', async () => {
    const tarea = await createTask(supervisor, {
      title: 'Terminada',
      priority: Priority.MEDIA,
      assigneeId: recepcion.id,
      checklist: [],
      tags: [],
    });
    await prisma.task.update({
      where: { id: tarea.id },
      data: { status: TaskStatus.COMPLETADA },
    });

    const board = await getAssignmentBoard();
    expect(board.workload.find((row) => row.userId === recepcion.id)?.openTasks).toBe(0);
  });

  it('los registros sin responsable también entran, con su habitación', async () => {
    const room = await prisma.room.findFirstOrThrow({ where: { number: '405' } });
    await createEntry(supervisor, {
      type: 'INCIDENCIA',
      title: 'Filtración sin responsable',
      description: 'Se detectó agua en el cielo del pasillo.',
      priority: Priority.ALTA,
      // Una incidencia exige gravedad: es una regla del libro, no del tablero.
      severity: Severity.ALTA,
      roomId: room.id,
      requiresFollowUp: false,
      tags: [],
    });

    const board = await getAssignmentBoard();
    const entry = board.unassigned.find((item) => item.kind === 'entry');
    expect(entry?.roomNumber).toBe('405');
    expect(entry?.href).toContain('/libro/');
  });

  it('el Administrador de sistema no aparece en la carga ni como asignable', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const board = await getAssignmentBoard();

    // Su rol no es operativo: no reparte ni recibe trabajo del mesón.
    expect(board.workload.map((row) => row.userId)).not.toContain(admin.id);
    expect(board.assignees.map((option) => option.value)).not.toContain(admin.id);
  });

  it('el gerente sí aparece como asignable: es el único modo de que actúe', async () => {
    const gerente = await createUser({ roleKey: ROLE_KEYS.MANAGEMENT });
    const board = await getAssignmentBoard();
    expect(board.assignees.map((option) => option.value)).toContain(gerente.id);
  });
});

describe('checklists de supervisión', () => {
  let supervisor: CurrentUser & { username: string };
  let otro: CurrentUser & { username: string };

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    otro = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Otro Supervisor' });
  });

  const PUNTOS = [
    '*Extintores con carga vigente',
    'Pasillos sin objetos',
    'Luces de emergencia',
  ];

  it('el asterisco marca el punto como crítico', async () => {
    const plantilla = await saveTemplate(supervisor, {
      name: 'Ronda de pisos',
      items: PUNTOS,
    });

    expect(plantilla.items).toHaveLength(3);
    expect(plantilla.items[0]?.text).toBe('Extintores con carga vigente');
    expect(plantilla.items[0]?.critical).toBe(true);
    expect(plantilla.items[1]?.critical).toBe(false);
  });

  it('una lista sin puntos se rechaza', async () => {
    await expect(
      saveTemplate(supervisor, { name: 'Vacía', items: ['', '   '] }),
    ).rejects.toThrow(/no controla nada/);
  });

  it('un punto que sólo tiene el asterisco se rechaza', async () => {
    await expect(
      saveTemplate(supervisor, { name: 'Rara', items: ['*'] }),
    ).rejects.toThrow(/sólo tiene el asterisco/);
  });

  it('editar la plantilla NO reescribe las rondas ya recorridas', async () => {
    /*
      Es la decisión que sostiene el módulo: la ejecución copia el texto. Si
      apuntara a la plantilla viva, editar un punto cambiaría lo que alguien
      ya firmó, y un control reescribible hacia atrás no controla nada.
    */
    const plantilla = await saveTemplate(supervisor, {
      name: 'Ronda de pisos',
      items: PUNTOS,
    });
    const ronda = await startRun(supervisor, { templateId: plantilla.id });

    await saveTemplate(supervisor, {
      id: plantilla.id,
      name: 'Ronda de pisos (v2)',
      items: ['Otro punto completamente distinto'],
    });

    const guardada = await prisma.checklistRun.findUniqueOrThrow({
      where: { id: ronda.id },
      include: { items: { orderBy: { order: 'asc' } } },
    });
    expect(guardada.templateName).toBe('Ronda de pisos');
    expect(guardada.items).toHaveLength(3);
    expect(guardada.items[0]?.text).toBe('Extintores con carga vigente');
  });

  it('una falla exige observación', async () => {
    const plantilla = await saveTemplate(supervisor, { name: 'Ronda', items: PUNTOS });
    const ronda = await startRun(supervisor, { templateId: plantilla.id });

    await expect(
      markRunItem(supervisor, { itemId: ronda.items[0]!.id, result: 'FALLA' }),
    ).rejects.toThrow(/sin observación/);

    const marcado = await markRunItem(supervisor, {
      itemId: ronda.items[0]!.id,
      result: 'FALLA',
      observation: 'Extintor del piso 5 vencido en agosto.',
    });
    expect(marcado.result).toBe('FALLA');
    expect(marcado.observation).toContain('vencido');
  });

  it('sólo quien recorre la ronda la marca', async () => {
    const plantilla = await saveTemplate(supervisor, { name: 'Ronda', items: PUNTOS });
    const ronda = await startRun(supervisor, { templateId: plantilla.id });

    /*
      Si cualquiera pudiera marcar, el control dejaría de decir quién revisó
      qué, que es todo su valor.
    */
    await expect(
      markRunItem(otro, { itemId: ronda.items[0]!.id, result: 'OK' }),
    ).rejects.toThrow(/otra persona/);
  });

  it('no se cierra con puntos sin revisar', async () => {
    const plantilla = await saveTemplate(supervisor, { name: 'Ronda', items: PUNTOS });
    const ronda = await startRun(supervisor, { templateId: plantilla.id });
    await markRunItem(supervisor, { itemId: ronda.items[0]!.id, result: 'OK' });

    await expect(finishRun(supervisor, { runId: ronda.id })).rejects.toThrow(
      /sin revisar/,
    );
  });

  it('se cierra contando las fallas y distinguiendo las críticas', async () => {
    const plantilla = await saveTemplate(supervisor, { name: 'Ronda', items: PUNTOS });
    const ronda = await startRun(supervisor, { templateId: plantilla.id });

    await markRunItem(supervisor, {
      itemId: ronda.items[0]!.id,
      result: 'FALLA',
      observation: 'Extintor vencido.',
    });
    await markRunItem(supervisor, {
      itemId: ronda.items[1]!.id,
      result: 'FALLA',
      observation: 'Carro de limpieza en el pasillo.',
    });
    await markRunItem(supervisor, { itemId: ronda.items[2]!.id, result: 'NO_APLICA' });

    const resultado = await finishRun(supervisor, {
      runId: ronda.id,
      notes: 'Se avisó a mantenimiento.',
    });

    expect(resultado.failures).toBe(2);
    // Sólo el primer punto era crítico.
    expect(resultado.criticalFailures).toBe(1);
    expect(resultado.run.finishedAt).not.toBeNull();
  });

  it('una ronda cerrada no admite cambios', async () => {
    const plantilla = await saveTemplate(supervisor, { name: 'Ronda', items: ['Único punto'] });
    const ronda = await startRun(supervisor, { templateId: plantilla.id });
    await markRunItem(supervisor, { itemId: ronda.items[0]!.id, result: 'OK' });
    await finishRun(supervisor, { runId: ronda.id });

    await expect(
      markRunItem(supervisor, { itemId: ronda.items[0]!.id, result: 'FALLA', observation: 'x' }),
    ).rejects.toThrow(/ya se cerró/);
    await expect(finishRun(supervisor, { runId: ronda.id })).rejects.toThrow(/ya está cerrada/);
  });

  it('una plantilla inactiva o eliminada no se puede recorrer', async () => {
    const plantilla = await saveTemplate(supervisor, {
      name: 'Ronda',
      items: PUNTOS,
      active: false,
    });
    await expect(startRun(supervisor, { templateId: plantilla.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const otra = await saveTemplate(supervisor, { name: 'Otra', items: PUNTOS });
    await softDeleteTemplate(supervisor, {
      templateId: otra.id,
      reason: 'Ya no se usa.',
    });
    await expect(startRun(supervisor, { templateId: otra.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('eliminar la plantilla conserva las rondas ya recorridas', async () => {
    const plantilla = await saveTemplate(supervisor, { name: 'Ronda', items: ['Único punto'] });
    const ronda = await startRun(supervisor, { templateId: plantilla.id });
    await markRunItem(supervisor, { itemId: ronda.items[0]!.id, result: 'OK' });
    await finishRun(supervisor, { runId: ronda.id });

    await softDeleteTemplate(supervisor, { templateId: plantilla.id, reason: 'Obsoleta.' });

    // La ronda sigue ahí, con su copia del texto.
    const guardada = await prisma.checklistRun.findUniqueOrThrow({
      where: { id: ronda.id },
      include: { items: true },
    });
    expect(guardada.items[0]?.text).toBe('Único punto');
    // Y la plantilla deja de listarse.
    expect((await listTemplates()).map((t) => t.id)).not.toContain(plantilla.id);
  });

  it('la ronda abierta de una persona se encuentra por su dueño', async () => {
    const plantilla = await saveTemplate(supervisor, { name: 'Ronda', items: PUNTOS });
    const ronda = await startRun(supervisor, { templateId: plantilla.id });

    expect((await getMyOpenRun(supervisor.id))?.id).toBe(ronda.id);
    expect(await getMyOpenRun(otro.id)).toBeNull();
  });
});
