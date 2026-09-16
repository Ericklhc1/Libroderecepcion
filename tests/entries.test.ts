import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EntryStatus, EntryType, Priority, Severity, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createShift,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
  openShiftAs,
} from './helpers';
import {
  changeEntryStatus,
  createEntry,
  getEntry,
  restoreEntry,
  softDeleteEntry,
  updateEntry,
} from '@/server/services/entries';
import { createFollowUp, updateFollowUp } from '@/server/services/followups';
import { addComment } from '@/server/services/comments';
import { getHistory } from '@/server/services/history';
import { NotFoundError, RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

describe('registros del libro operativo', () => {
  let receptionist: CurrentUser;
  let supervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción' });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisión' });
  });

  const novedad = {
    type: EntryType.NOVEDAD,
    title: 'Codificador de llaves con error E-04',
    description: 'Se reinició el equipo y volvió a operar con normalidad.',
    priority: Priority.BAJA,
    tags: ['llaves'],
    requiresFollowUp: false,
  };

  it('crea una novedad con su numeración, autor y auditoría', async () => {
    const entry = await createEntry(receptionist, novedad);

    expect(entry.seq).toBeGreaterThan(0);
    expect(entry.createdById).toBe(receptionist.id);
    expect(entry.status).toBe(EntryStatus.ABIERTO);
    expect(entry.tags).toEqual(['llaves']);

    const log = await prisma.auditLog.findFirst({
      where: { entity: 'OperationalEntry', entityId: entry.id, action: 'CREAR' },
    });
    expect(log?.userId).toBe(receptionist.id);
    expect(log?.summary).toContain(`#${entry.seq}`);
  });

  it('asocia el registro al turno abierto de quien lo crea', async () => {
    const shift = await createShift({ userId: receptionist.id, type: ShiftType.DIA });
    await openShiftAs(receptionist, shift);

    const entry = await createEntry(receptionist, novedad);
    expect(entry.shiftId).toBe(shift.id);
  });

  it('normaliza las etiquetas y descarta duplicados', async () => {
    const entry = await createEntry(receptionist, {
      ...novedad,
      tags: ['VIP', 'vip', ' Climatizacion '],
    });
    expect(entry.tags.sort()).toEqual(['climatizacion', 'vip']);
  });

  it('exige gravedad al crear una incidencia', async () => {
    await expect(
      createEntry(receptionist, {
        ...novedad,
        type: EntryType.INCIDENCIA,
        title: 'Incidencia sin gravedad declarada',
      }),
    ).rejects.toThrow(/requiere indicar su gravedad/);
  });

  it('guarda los campos propios de la incidencia y descarta los ajenos', async () => {
    const incident = await createEntry(receptionist, {
      ...novedad,
      type: EntryType.INCIDENCIA,
      title: 'Aire acondicionado sin enfriar en la 318',
      severity: Severity.ALTA,
      impact: 'HUESPED',
      immediateAction: 'Se entregó ventilador de pie.',
    });
    expect(incident.severity).toBe(Severity.ALTA);
    expect(incident.impact).toBe('HUESPED');
    expect(incident.immediateAction).toContain('ventilador');

    // Una novedad no arrastra gravedad ni impacto aunque se envíen.
    const plain = await createEntry(receptionist, {
      ...novedad,
      severity: Severity.CRITICA,
      impact: 'SEGURIDAD',
    });
    expect(plain.severity).toBeNull();
    expect(plain.impact).toBeNull();
  });

  it('avisa a supervisión cuando la incidencia es crítica', async () => {
    await createEntry(receptionist, {
      ...novedad,
      type: EntryType.INCIDENCIA,
      title: 'Corte de energía en el ala sur',
      severity: Severity.CRITICA,
    });

    const notification = await prisma.notification.findFirst({
      where: { userId: supervisor.id, type: 'INCIDENCIA_CRITICA' },
    });
    expect(notification).not.toBeNull();
  });

  it('notifica al responsable asignado', async () => {
    await createEntry(supervisor, { ...novedad, ownerId: receptionist.id });
    const notification = await prisma.notification.findFirst({
      where: { userId: receptionist.id, entity: 'OperationalEntry' },
    });
    expect(notification).not.toBeNull();
  });

  it('registra el cambio de responsable y de prioridad por separado', async () => {
    const entry = await createEntry(receptionist, novedad);

    await updateEntry(supervisor, { id: entry.id, ownerId: receptionist.id });
    await updateEntry(supervisor, { id: entry.id, priority: Priority.ALTA });

    const actions = await prisma.auditLog.findMany({
      where: { entityId: entry.id },
      select: { action: true },
    });
    const kinds = actions.map((a) => a.action);
    expect(kinds).toContain('CAMBIO_RESPONSABLE');
    expect(kinds).toContain('CAMBIO_PRIORIDAD');
  });

  it('no registra auditoría si la edición no cambia nada', async () => {
    const entry = await createEntry(receptionist, novedad);
    const before = await prisma.auditLog.count({ where: { entityId: entry.id } });

    await updateEntry(receptionist, { id: entry.id, title: novedad.title });

    expect(await prisma.auditLog.count({ where: { entityId: entry.id } })).toBe(before);
  });

  it('exige resolución para cerrar una incidencia', async () => {
    const incident = await createEntry(receptionist, {
      ...novedad,
      type: EntryType.INCIDENCIA,
      title: 'Filtración en el cielo del lobby',
      severity: Severity.MEDIA,
    });

    await expect(
      changeEntryStatus(supervisor, { id: incident.id, status: EntryStatus.CERRADO }),
    ).rejects.toThrow(/debes registrar cómo se resolvió/);

    const closed = await changeEntryStatus(supervisor, {
      id: incident.id,
      status: EntryStatus.CERRADO,
      resolution: 'Se sellaron las juntas del piso superior.',
      rootCause: 'Sello deteriorado en la terraza.',
    });
    expect(closed.status).toBe(EntryStatus.CERRADO);
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedById).toBe(supervisor.id);
    expect(closed.rootCause).toContain('Sello deteriorado');
  });

  it('no permite cerrar un registro con seguimientos abiertos', async () => {
    const entry = await createEntry(receptionist, novedad);
    const followUp = await createFollowUp(receptionist, {
      entryId: entry.id,
      action: 'Se pidió revisión al proveedor.',
    });

    await expect(
      changeEntryStatus(supervisor, { id: entry.id, status: EntryStatus.CERRADO }),
    ).rejects.toThrow(/seguimiento\(s\) sin cerrar/);

    await updateFollowUp(receptionist, {
      id: followUp.id,
      status: 'CUMPLIDO',
      result: 'El proveedor confirmó el recambio.',
    });

    const closed = await changeEntryStatus(supervisor, {
      id: entry.id,
      status: EntryStatus.CERRADO,
    });
    expect(closed.status).toBe(EntryStatus.CERRADO);
  });

  it('sólo quien tiene el permiso puede reabrir un registro cerrado', async () => {
    const entry = await createEntry(receptionist, novedad);
    await changeEntryStatus(supervisor, { id: entry.id, status: EntryStatus.CERRADO });

    await expect(
      changeEntryStatus(receptionist, { id: entry.id, status: EntryStatus.ABIERTO }),
    ).rejects.toThrow(/permiso para reabrir/);

    const reopened = await changeEntryStatus(supervisor, {
      id: entry.id,
      status: EntryStatus.EN_CURSO,
      reason: 'El huésped reporta que el problema persiste.',
    });
    expect(reopened.status).toBe(EntryStatus.EN_CURSO);
    expect(reopened.reopenedAt).not.toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { entityId: entry.id, action: 'REABRIR' },
    });
    expect(log?.reason).toContain('persiste');
  });

  it('un registro cerrado no admite edición sin permiso de reapertura', async () => {
    const entry = await createEntry(receptionist, novedad);
    await changeEntryStatus(supervisor, { id: entry.id, status: EntryStatus.CERRADO });

    await expect(
      updateEntry(receptionist, { id: entry.id, title: 'Título cambiado' }),
    ).rejects.toThrow(/Reábrelo para poder editarlo/);
  });

  it('exige un seguimiento asociado a un registro o tarea', async () => {
    await expect(
      createFollowUp(receptionist, { action: 'Seguimiento sin dueño' }),
    ).rejects.toThrow(/debe asociarse a un registro o a una tarea/);
  });

  it('marca el registro como "con seguimiento" al crear uno', async () => {
    const entry = await createEntry(receptionist, novedad);
    expect(entry.requiresFollowUp).toBe(false);

    await createFollowUp(receptionist, { entryId: entry.id, action: 'Llamada al proveedor.' });

    const updated = await getEntry(entry.id);
    expect(updated.requiresFollowUp).toBe(true);
  });

  it('exige resultado para cerrar un seguimiento', async () => {
    const entry = await createEntry(receptionist, novedad);
    const followUp = await createFollowUp(receptionist, {
      entryId: entry.id,
      action: 'Coordinación con mantenimiento.',
    });

    await expect(
      updateFollowUp(receptionist, { id: followUp.id, status: 'CUMPLIDO' }),
    ).rejects.toThrow(/debes registrar el resultado/);
  });
});

describe('eliminación lógica y recuperación', () => {
  let receptionist: CurrentUser;
  let supervisor: CurrentUser;
  let admin: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
  });

  it('no borra el registro: lo marca con motivo, autor y fecha', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Registro que será eliminado',
      description: 'Creado por error durante la carga inicial.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
    });

    await softDeleteEntry(supervisor, { id: entry.id, reason: 'Duplicado del registro anterior.' });

    const stored = await prisma.operationalEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.deletedById).toBe(supervisor.id);
    expect(stored.deletionReason).toBe('Duplicado del registro anterior.');

    const log = await prisma.auditLog.findFirst({
      where: { entityId: entry.id, action: 'ELIMINAR' },
    });
    expect(log?.reason).toBe('Duplicado del registro anterior.');
  });

  it('un registro eliminado desaparece de la operación y no admite cambios', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Registro eliminado y luego editado',
      description: 'Verifica que la eliminación lógica protege el registro.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
    });
    await softDeleteEntry(supervisor, { id: entry.id, reason: 'Motivo suficiente.' });

    await expect(
      updateEntry(supervisor, { id: entry.id, title: 'Nuevo título' }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      changeEntryStatus(supervisor, { id: entry.id, status: EntryStatus.CERRADO }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      softDeleteEntry(supervisor, { id: entry.id, reason: 'Otro motivo.' }),
    ).rejects.toThrow(/ya fue eliminado/);
  });

  it('el Administrador de sistema puede restaurar el registro', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Registro a restaurar',
      description: 'Se elimina y se recupera para comprobar la trazabilidad.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
    });
    await softDeleteEntry(supervisor, { id: entry.id, reason: 'Eliminado por error.' });

    const restored = await restoreEntry(admin, {
      id: entry.id,
      reason: 'Se confirmó que el registro era válido.',
    });
    expect(restored.deletedAt).toBeNull();
    expect(restored.deletionReason).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { entityId: entry.id, action: 'RESTAURAR' },
    });
    expect(log?.userId).toBe(admin.id);
    expect(log?.reason).toContain('era válido');
  });

  it('no restaura un registro que no está eliminado', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Registro vigente',
      description: 'No está eliminado, por lo que no puede restaurarse.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
    });
    await expect(restoreEntry(admin, { id: entry.id })).rejects.toThrow(/no está eliminado/);
  });
});

describe('historial de un registro', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('reúne creación, cambios, comentarios, seguimientos y cierre en orden', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });

    const entry = await createEntry(receptionist, {
      type: EntryType.INCIDENCIA,
      title: 'Ascensor detenido entre pisos',
      description: 'Se liberó al huésped y se llamó al servicio técnico.',
      priority: Priority.ALTA,
      severity: Severity.ALTA,
      tags: [],
      requiresFollowUp: false,
    });

    await addComment(supervisor, { entryId: entry.id, body: 'Confirmar el informe del técnico.' });
    const followUp = await createFollowUp(receptionist, {
      entryId: entry.id,
      action: 'Se solicitó informe al servicio técnico.',
      nextAction: 'Recibir el informe firmado.',
    });
    await updateFollowUp(receptionist, {
      id: followUp.id,
      status: 'CUMPLIDO',
      result: 'Informe recibido y archivado.',
    });
    await changeEntryStatus(supervisor, {
      id: entry.id,
      status: EntryStatus.CERRADO,
      resolution: 'Ascensor operativo y certificado.',
    });

    const history = await getHistory({ entity: 'OperationalEntry', entityId: entry.id });
    const kinds = history.map((event) => event.kind);
    const labels = history.map((event) => event.actionLabel);

    expect(kinds).toContain('auditoria');
    expect(kinds).toContain('comentario');
    expect(kinds).toContain('seguimiento');
    expect(labels).toContain('Creación');
    expect(labels).toContain('Cierre');

    // Orden cronológico ascendente.
    const times = history.map((event) => event.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('notifica a los interesados cuando alguien comenta su registro', async () => {
    const author = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const other = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });

    const entry = await createEntry(author, {
      type: EntryType.NOVEDAD,
      title: 'Registro con comentarios cruzados',
      description: 'Verifica el aviso al autor cuando otra persona comenta.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
    });

    await addComment(other, { entryId: entry.id, body: 'Reviso esto en mi turno.' });

    const notification = await prisma.notification.findFirst({
      where: { userId: author.id, type: 'COMENTARIO' },
    });
    expect(notification).not.toBeNull();

    // Comentar tu propio registro no genera autoaviso.
    await addComment(author, { entryId: entry.id, body: 'Queda coordinado.' });
    expect(
      await prisma.notification.count({ where: { userId: author.id, type: 'COMENTARIO' } }),
    ).toBe(1);
  });

  it('un comentario debe referirse a un único registro', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await expect(addComment(user, { body: 'Comentario huérfano' })).rejects.toThrow(RuleError);
  });
});
