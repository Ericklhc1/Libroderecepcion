import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { createUser, prisma, resetOperationalData, seedCatalog } from './helpers';
import { saveScheduleCollaborator, removeScheduleMembership, getScheduleCatalog, saveScheduleTemplate, saveScheduleCoverage, saveScheduleGrant } from '@/server/services/schedule-catalog';
import { createSchedulePlan, addScheduleSlot, getScheduleBoard, getSchedulePlan, moveScheduleSlot, cancelScheduleSlot, publishSchedulePlan, changeScheduleExtra, acknowledgeSchedule } from '@/server/services/schedules';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';
import { executeFrontiPageContextTool } from '@/server/ai/fronti-v2/page-context-tool';
import { readScheduleContext, scheduleReviewReply } from '@/server/ai/fronti-v2/schedule-context';
import { runReceptionAssistant } from '@/server/ai/reception-assistant';
import { buildFrontiRuntimeContext } from '@/server/ai/fronti-v2/context-builder';
import { scheduleAuditVisibility } from '@/server/services/schedule-access';
import { scheduleCsvTemplate } from '@/domain/schedule-csv';
import { reviewScheduleImport, applyScheduleImport, refreshScheduleImport } from '@/server/services/schedule-import';

describe('Equipo y horarios: flujo persistente en PostgreSQL desechable', () => {
  let admin: CurrentUser; let reader: CurrentUser; let own: CurrentUser; let area: string; let other: string; let planId: string; let a: string; let b: string; let day: string; let night: string;
  beforeAll(seedCatalog);
  let nonOperationalRoleId: string | null = null;
  afterEach(async () => {
    vi.useRealTimers();
    if (nonOperationalRoleId) {
      await prisma.user.updateMany({ where: { roleId: nonOperationalRoleId }, data: { roleId: own.roleId } });
      await prisma.role.delete({ where: { id: nonOperationalRoleId } });
      nonOperationalRoleId = null;
    }
  });
  beforeEach(async () => {
    await resetOperationalData();
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    reader = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    own = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Colaborador Uno' });
    area = (await prisma.department.findUniqueOrThrow({ where: { key: 'RECEPCION' } })).id;
    other = (await prisma.department.findUniqueOrThrow({ where: { key: 'HOUSEKEEPING' } })).id;
    const person = await saveScheduleCollaborator(admin, { employeeCode: 'TEST_COL001', name: 'Colaborador Uno', functionName: 'Recepcionista', userId: own.id, departmentIds: [area, other], active: true }); a = person.id;
    b = (await saveScheduleCollaborator(admin, { employeeCode: 'TEST_COL002', name: 'Colaborador Dos', userId: (await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Colaborador Dos' })).id, functionName: 'Recepcionista', departmentIds: [area], active: true })).id;
    day = (await saveScheduleTemplate(admin, { departmentId: area, code: 'TEST_DIA', label: 'Día', startTime: '08:00', endTime: '19:00', crossesMidnight: false })).id;
    night = (await saveScheduleTemplate(admin, { departmentId: area, code: 'TEST_NOCHE', label: 'Noche', startTime: '21:00', endTime: '08:00', crossesMidnight: true })).id;
    planId = (await createSchedulePlan(admin, { departmentId: area, startDate: '2090-10-01', endDate: '2090-10-08' })).id;
    own = { ...own, permissions: ['schedule.self.view'] };
    await prisma.rolePermission.createMany({ data: [{ roleId: own.roleId, permissionId: (await prisma.permission.findUniqueOrThrow({ where: { key: 'schedule.self.view' } })).id }], skipDuplicates: true });
  });
  const mutation = async (id = planId, reason = '') => ({ planId: id, version: (await prisma.schedulePlan.findUniqueOrThrow({ where: { id } })).version, requestKey: randomUUID(), reason });
  const add = async (person = a, date = '2090-10-03', templateId = day, extraKind = 'NINGUNO', extraMinutes = 0) => addScheduleSlot(admin, await mutation(planId, 'Planificación revisada'), { collaboratorId: person, date, kind: 'TURNO', templateId, extraKind, extraMinutes });
  const slot = async (person = a, date = '2090-10-03') => prisma.scheduleSlot.findFirstOrThrow({ where: { planId, collaboratorId: person, date: new Date(date), cancelledAt: null } });
  it('reutiliza usuarios existentes, mantiene área explícita y no crea un turno operativo', async () => {
    expect((await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: b } })).userId).not.toBeNull();
    await add(); expect(await prisma.shift.count()).toBe(0); expect(await prisma.shiftAssignment.count()).toBe(0); expect(await prisma.cashMovement.count()).toBe(0);
    expect((await getScheduleBoard(admin, area, planId)).collaborators).toHaveLength(2);
  });
  it('añadir el mismo usuario conserva identidad, áreas y referencia; edita en horas', async () => {
    const original = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: a } });
    const updated = await saveScheduleCollaborator(admin, { id: a, version: original.version, userId: own.id, departmentIds: [area], weeklyHours: 44 });
    const added = await saveScheduleCollaborator(admin, { userId: own.id, departmentIds: [other], weeklyHours: 8, functionName: 'Otra función' });
    expect(added.id).toBe(a); expect(added.weeklyMinutes).toBe(2640); expect(added.functionName).toBe(updated.functionName);
    expect(await prisma.scheduleMembership.count({ where: { collaboratorId: a, active: true } })).toBe(2);
    expect(await prisma.scheduleCollaborator.count({ where: { userId: own.id } })).toBe(1);
    await expect(saveScheduleCollaborator(admin, { userId: '', departmentIds: [area] })).rejects.toThrow();
    await prisma.user.update({ where: { id: own.id }, data: { active: false } });
    await expect(add()).rejects.toThrow('activo');
  });
  it('deja el módulo deshabilitado para otros roles y separa lectura, edición y alcance', async () => {
    await expect(getScheduleBoard(reader, area)).rejects.toThrow('no está habilitado');
    reader = { ...reader, permissions: ['schedule.view'], departmentId: area };
    await expect(getSchedulePlan(reader, planId)).rejects.toThrow();
    await expect(addScheduleSlot(reader, await mutation(), { collaboratorId: a, date: '2090-10-03', kind: 'TURNO', templateId: day })).rejects.toThrow();
    await add(); await publishSchedulePlan(admin, await mutation(planId, 'Cobertura revisada'));
    expect((await getScheduleBoard(reader, area, planId)).slots).toHaveLength(1); await expect(getScheduleBoard(reader, other)).rejects.toThrow();
    expect((await getScheduleBoard(reader, area, planId)).imports).toEqual([]);
  });
  it('un permiso de lectura global no concede edición global', async () => {
    reader = { ...reader, departmentId: other, permissions: ['schedule.view.all', 'schedule.manage'] };
    await expect(addScheduleSlot(reader, await mutation(), { collaboratorId: a, date: '2090-10-03', kind: 'TURNO', templateId: day })).rejects.toThrow('fuera de tu alcance');
    await saveScheduleGrant(admin, reader.id, area, true);
    await addScheduleSlot(reader, await mutation(), { collaboratorId: a, date: '2090-10-03', kind: 'TURNO', templateId: day }); expect(await prisma.scheduleSlot.count({ where: { planId } })).toBe(1);
  });
  it('evita periodos superpuestos en el área y reutiliza una creación idéntica', async () => {
    expect((await createSchedulePlan(admin, { departmentId: area, startDate: '2090-10-01', endDate: '2090-10-08' })).id).toBe(planId);
    await expect(createSchedulePlan(admin, { departmentId: area, startDate: '2090-10-08', endDate: '2090-10-12' })).rejects.toThrow('se cruza');
  });
  it('bloquea superposición nocturna entre áreas y asignación a personas ajenas al área', async () => {
    await add(a, '2090-10-03', night);
    const otherPlan = await createSchedulePlan(admin, { departmentId: other, startDate: '2090-10-01', endDate: '2090-10-08' });
    const template = await saveScheduleTemplate(admin, { departmentId: other, code: 'TEST_HSK', label: 'Temprano', startTime: '07:00', endTime: '15:00', crossesMidnight: false });
    await expect(addScheduleSlot(admin, await mutation(otherPlan.id), { collaboratorId: a, date: '2090-10-04', kind: 'TURNO', templateId: template.id })).rejects.toThrow('superpuestos');
    await expect(addScheduleSlot(admin, await mutation(otherPlan.id), { collaboratorId: b, date: '2090-10-05', kind: 'TURNO', templateId: template.id })).rejects.toThrow('habilitado');
    expect(await prisma.scheduleSlot.count({ where: { planId: otherPlan.id } })).toBe(0);
  });
  it('hace un intercambio atómico sin borrar los originales', async () => {
    await add(); await add(b, '2090-10-03', night); const source = await slot(); const target = await slot(b);
    await moveScheduleSlot(admin, await mutation(), { slotId: source.id, targetCollaboratorId: b, targetDate: '2090-10-03', targetSlotId: target.id, mode: 'INTERCAMBIAR' });
    expect((await slot()).code).toBe('TEST_NOCHE'); expect((await slot(b)).code).toBe('TEST_DIA'); expect(await prisma.scheduleSlot.count({ where: { planId, cancelledAt: { not: null } } })).toBe(2);
  });
  it('si el intercambio contradice otra jornada, revierte los dos destinos y sus cancelaciones', async () => {
    await add(); await add(b, '2090-10-03', night); await add(a, '2090-10-04', (await saveScheduleTemplate(admin, { departmentId: area, code: 'TEST_TEMPRANO', label: 'Temprano', startTime: '07:00', endTime: '15:00', crossesMidnight: false })).id);
    const source = await slot(); const target = await slot(b);
    await expect(moveScheduleSlot(admin, await mutation(), { slotId: source.id, targetCollaboratorId: b, targetDate: '2090-10-03', targetSlotId: target.id, mode: 'INTERCAMBIAR' })).rejects.toThrow('superpuestos');
    expect((await slot()).id).toBe(source.id); expect((await slot(b)).id).toBe(target.id); expect(await prisma.scheduleSlot.count({ where: { planId, cancelledAt: { not: null } } })).toBe(0);
  });
  it('agregar cobertura conserva el original y mover cambia únicamente su fecha', async () => {
    await add(); const source = await slot(); await moveScheduleSlot(admin, await mutation(), { slotId: source.id, targetCollaboratorId: b, targetDate: '2090-10-03', mode: 'AGREGAR' }); expect((await slot()).id).toBe(source.id);
    await moveScheduleSlot(admin, await mutation(), { slotId: source.id, targetCollaboratorId: a, targetDate: '2090-10-05', mode: 'MOVER' }); expect((await slot(a, '2090-10-05')).code).toBe('TEST_DIA'); expect((await prisma.scheduleSlot.findUniqueOrThrow({ where: { id: source.id } })).cancelledAt).not.toBeNull();
  });
  it('rechaza cambios simultáneos sobre la misma versión y admite reintento idempotente', async () => {
    const m = await mutation(); const data = { collaboratorId: a, date: '2090-10-03', kind: 'TURNO', templateId: day };
    await addScheduleSlot(admin, m, data); await addScheduleSlot(admin, m, data);
    expect(await prisma.scheduleSlot.count({ where: { planId, cancelledAt: null } })).toBe(1);
    await expect(addScheduleSlot(admin, m, { ...data, collaboratorId: b })).rejects.toThrow('otros datos');
    const concurrent = await mutation(); const results = await Promise.allSettled([addScheduleSlot(admin, concurrent, { ...data, date: '2090-10-04' }), addScheduleSlot(admin, { ...concurrent, requestKey: randomUUID() }, { ...data, collaboratorId: b, date: '2090-10-04' })]); expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('ignora descanso histórico y conserva control de ausencias superpuestas', async () => {
    const person = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: a } }); await prisma.scheduleCollaborator.update({ where: { id: person.id }, data: { minRestMinutes: 720 } });
    await add(a, '2090-10-03', night); await add(a, '2090-10-04', day);
    await addScheduleSlot(admin, await mutation(planId, 'Revisar ausencia'), { collaboratorId: a, date: '2090-10-04', kind: 'LIBRE' }, (await slot(a, '2090-10-04')).id);
    const free = await slot(a, '2090-10-04'); await expect(addScheduleSlot(admin, await mutation(), { collaboratorId: a, date: '2090-10-04', kind: 'VACACIONES' }, free.id)).rejects.toThrow();
  });
  it('conserva snapshots al revisar una plantilla y exige horas exactas al cargar', async () => {
    await add(); const before = await slot(); await saveScheduleTemplate(admin, { departmentId: area, code: 'TEST_DIA', label: 'Nueva glosa', startTime: '09:00', endTime: '19:00', crossesMidnight: false });
    expect((await slot()).startAt).toEqual(before.startAt); expect((await slot()).startTime).toBe('08:00');
    const draft = await reviewScheduleImport(admin, planId, 'malla.csv', new TextEncoder().encode('ID_COLABORADOR;FECHA;CODIGO;INICIO;TERMINO\nTEST_COL002;2090-10-05;TEST_DIA;08:00;19:00\n'));
    expect(JSON.stringify(draft.issues)).toContain('no coinciden'); await expect(applyScheduleImport(admin, await mutation(), draft.id)).rejects.toThrow('observaciones');
  });
  it('la carga tiene revisión, no sobrescribe y no duplica una incorporación repetida', async () => {
    const bytes = new TextEncoder().encode('ID_COLABORADOR;FECHA;CODIGO;INICIO;TERMINO\nTEST_COL001;2090-10-03;TEST_DIA;08:00;19:00\nTEST_COL002;2090-10-03;LIBRE;;\n');
    const draft = await reviewScheduleImport(admin, planId, 'malla.csv', bytes); expect(draft.issues).toEqual([]); expect(await prisma.scheduleSlot.count({ where: { planId } })).toBe(0);
    const m = await mutation(); await applyScheduleImport(admin, m, draft.id); await applyScheduleImport(admin, m, draft.id); expect(await prisma.scheduleSlot.count({ where: { planId, cancelledAt: null } })).toBe(2);
    expect((await reviewScheduleImport(admin, planId, 'malla.csv', bytes)).status).toBe('APLICADO');
  });
  it('incorpora filas futuras de un archivo mixto y conserva las jornadas iniciadas', async () => {
    await add(); const original = await slot();
    const bytes = new TextEncoder().encode('ID_COLABORADOR;FECHA;CODIGO\nTEST_COL001;2090-10-02;LIBRE\nTEST_COL001;2090-10-03;TEST_DIA\nTEST_COL002;2090-10-03;TEST_NOCHE\nTEST_COL002;2090-10-04;TEST_DIA\n');
    const draft = await reviewScheduleImport(admin, planId, 'mes.csv', bytes);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2090-10-03T18:00:00Z'));
    expect((await getScheduleBoard(admin, area, planId)).imports[0]?.omittedRows).toEqual([0, 1]);
    const m = await mutation(); await applyScheduleImport(admin, m, draft.id); await applyScheduleImport(admin, m, draft.id);
    expect(await prisma.scheduleSlot.count({ where: { planId, cancelledAt: null } })).toBe(3);
    expect(await prisma.scheduleSlot.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.scheduleSlot.count({ where: { planId, date: new Date('2090-10-02') } })).toBe(0);
    const event = await prisma.scheduleEvent.findUniqueOrThrow({ where: { requestKey: m.requestKey } });
    expect((event.after as { omitted: unknown[] }).omitted).toHaveLength(2);
    expect((await prisma.scheduleImport.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('APLICADO');
    await expect(cancelScheduleSlot(admin, await mutation(planId, 'No modificar historia'), original.id)).rejects.toThrow('ya comenzó');
    expect(await prisma.shift.count()).toBe(0); expect(await prisma.shiftAssignment.count()).toBe(0);
  });
  it('una carga totalmente pasada no modifica la versión ni crea asignaciones', async () => {
    const draft = await reviewScheduleImport(admin, planId, 'pasado.csv', new TextEncoder().encode('ID_COLABORADOR;FECHA;CODIGO\nTEST_COL001;2090-10-02;TEST_DIA\nTEST_COL002;2090-10-02;LIBRE\n'));
    const m = await mutation(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2090-10-03T18:00:00Z'));
    await expect(applyScheduleImport(admin, m, draft.id)).rejects.toThrow('No quedan asignaciones futuras');
    expect((await mutation()).version).toBe(m.version);
    expect(await prisma.scheduleSlot.count({ where: { planId } })).toBe(0);
    expect((await prisma.scheduleImport.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('REVISION');
  });
  it('una revisión de archivo obsoleta no pisa cambios posteriores', async () => {
    const draft = await reviewScheduleImport(admin, planId, 'malla.csv', new TextEncoder().encode('ID_COLABORADOR;FECHA;CODIGO\nTEST_COL001;2090-10-03;TEST_DIA\n')); await add(b, '2090-10-05');
    await expect(applyScheduleImport(admin, await mutation(), draft.id)).rejects.toThrow('desde la revisión'); expect(await prisma.scheduleSlot.count({ where: { planId, cancelledAt: null } })).toBe(1);
  });

  it('vuelve a revisar un archivo al corregir nombres sin aplicar horarios', async () => {
    const bytes = new TextEncoder().encode('NOMBRE;FECHA;CODIGO\nNombre corregido;2090-10-03;TEST_DIA\n');
    const draft = await reviewScheduleImport(admin, planId, 'horario.csv', bytes);
    expect(draft.issues).not.toEqual([]);
    await prisma.user.update({ where: { id: own.id }, data: { name: 'Nombre corregido' } });
    const refreshed = await refreshScheduleImport(admin, draft.id);
    expect(refreshed.issues).toEqual([]);
    expect((await reviewScheduleImport(admin, planId, 'horario.csv', bytes)).issues).toEqual([]);
    expect(await prisma.scheduleSlot.count({ where: { planId } })).toBe(0);
    await add(b, '2090-10-05');
    const current = await refreshScheduleImport(admin, draft.id);
    expect(current.baseVersion).toBe((await mutation()).version);
    await expect(refreshScheduleImport(reader, current.id)).rejects.toThrow();
    await applyScheduleImport(admin, await mutation(planId, 'Archivo revisado'), current.id);
    expect(await prisma.scheduleSlot.count({ where: { planId, cancelledAt: null } })).toBe(2);
  });
  it('Fronti revisa horas y archivos desde las fuentes reales, sin modelo ni asistencia inventada', async () => {
    await add();
    const data = await readScheduleContext(admin, { area, planId });
    expect(data.assignments?.[0]?.label).toBe('TEST_DIA · 08:00–19:00');
    expect(scheduleReviewReply(data)).toContain('no inicia turnos');
    const context = await buildFrontiRuntimeContext(admin, { pathname: '/equipo', search: `?area=${area}&malla=${planId}` });
    const result = await runReceptionAssistant(admin, [{ role: 'user', content: 'Revisa este horario y el archivo: qué errores hay' }], context);
    expect(result.reply).toContain('08:00–19:00'); expect(result.reply).toContain('Borrador');
    expect(result.confirmations).toEqual([]); expect(await prisma.shift.count()).toBe(0);
    const publication = await runReceptionAssistant(admin, [{ role: 'user', content: '¿Publicar el horario abre un turno operativo?' }], context);
    expect(publication.reply).toContain('Tampoco genera turnos operativos');
    expect(publication.reply).toContain('independientemente del horario publicado');
    expect(publication.confirmations).toEqual([]);
    await expect(readScheduleContext(reader, { area, planId })).rejects.toThrow();
    await publishSchedulePlan(admin, await mutation(planId, 'Publicación revisada'));
    const mine = await readScheduleContext(own, { area, planId, date: '2090-10-03' });
    expect(mine.assignments).toHaveLength(1); expect(mine.imports).toEqual([]);
    await expect(readScheduleContext({ ...reader, departmentId: area, permissions: ['schedule.view'] }, { area: other })).rejects.toThrow();
  });
  it('publica, notifica y confirma por persona; confirmar no registra asistencia', async () => {
    await add(); await add(b); await publishSchedulePlan(admin, await mutation(planId, 'Cobertura confirmada'));
    const board = await getScheduleBoard(own, area, planId); expect(board.slots).toHaveLength(1); expect(board.slots[0]?.collaboratorId).toBe(a); expect(board.events).toEqual([]);
    const ack = await prisma.scheduleAcknowledgment.findFirstOrThrow({ where: { planId, userId: own.id } }); await acknowledgeSchedule(own, planId, ack.version); expect((await prisma.scheduleAcknowledgment.findUniqueOrThrow({ where: { id: ack.id } })).acknowledgedAt).not.toBeNull(); expect(await prisma.shift.count()).toBe(0);
    const s = await slot(); await moveScheduleSlot(admin, await mutation(planId, 'Cambio solicitado por colaborador'), { slotId: s.id, targetCollaboratorId: a, targetDate: '2090-10-05', mode: 'MOVER' });
    await expect(acknowledgeSchedule(own, planId, ack.version)).rejects.toThrow('más reciente'); expect(await prisma.notification.count({ where: { userId: own.id, entity: 'SchedulePlan' } })).toBe(2);
  });
  it('no permite cambiar una malla publicada sin permiso de publicación o sin motivo', async () => {
    await add(); await publishSchedulePlan(admin, await mutation(planId, 'Revisada'));
    reader = { ...reader, departmentId: area, permissions: ['schedule.manage'] };
    await expect(addScheduleSlot(reader, await mutation(planId, 'Cambio'), { collaboratorId: b, date: '2090-10-05', kind: 'TURNO', templateId: day })).rejects.toThrow();
    await expect(addScheduleSlot(admin, await mutation(), { collaboratorId: b, date: '2090-10-05', kind: 'TURNO', templateId: day })).rejects.toThrow('motivo');
  });
  it('solicita, aprueba, informa y valida extras con estados y evidencias independientes', async () => {
    await add(a, '2090-10-03', day, 'EXTENSION', 120); let s = await slot(); expect(s.extraStatus).toBe('PENDIENTE'); expect((s.endAt!.getTime() - s.baseEndAt!.getTime()) / 60000).toBe(120);
    await expect(moveScheduleSlot(admin, await mutation(), { slotId: s.id, targetCollaboratorId: b, targetDate: '2090-10-03', mode: 'REASIGNAR' })).rejects.toThrow('extras');
    await changeScheduleExtra(admin, await mutation(planId, 'Refuerzo aprobado'), { slotId: s.id, action: 'APROBAR' });
    await expect(changeScheduleExtra(admin, await mutation(planId, 'Realización'), { slotId: s.id, action: 'REPORTAR', reportedMinutes: 90 })).rejects.toThrow('después');
    await prisma.scheduleSlot.update({ where: { id: s.id }, data: { date: new Date('2020-01-01'), startAt: new Date('2020-01-01T11:00:00Z'), baseEndAt: new Date('2020-01-01T22:00:00Z'), endAt: new Date('2020-01-02T00:00:00Z') } });
    await changeScheduleExtra(admin, await mutation(planId, 'Registro informado por responsable'), { slotId: s.id, action: 'REPORTAR', reportedMinutes: 90 }); await changeScheduleExtra(admin, await mutation(planId, 'Evidencia contrastada'), { slotId: s.id, action: 'VALIDAR' });
    s = await prisma.scheduleSlot.findUniqueOrThrow({ where: { id: s.id } }); expect(s.extraStatus).toBe('VALIDADO'); expect(s.reportedExtraMinutes).toBe(90);
  });
  it('los extras pendientes no cubren una brecha; la aprobación habilita esa cobertura', async () => {
    await saveScheduleCoverage(admin, { departmentId: area, name: 'Refuerzo tarde', weekdays: [0,1,2,3,4,5,6], startTime: '19:00', endTime: '21:00', crossesMidnight: false, minimum: 1 });
    await add(a, '2090-10-03', day, 'EXTENSION', 120); const s = await slot(); expect((await getScheduleBoard(admin, area, planId)).gaps.some((g) => g.date === '2090-10-03')).toBe(true);
    await changeScheduleExtra(admin, await mutation(planId, 'Necesidad confirmada'), { slotId: s.id, action: 'APROBAR' }); expect((await getScheduleBoard(admin, area, planId)).gaps.some((g) => g.date === '2090-10-03')).toBe(false);
  });
  it('las asignaciones iniciadas no se arrastran ni cancelan', async () => {
    await add(); const s = await slot(); await prisma.scheduleSlot.update({ where: { id: s.id }, data: { startAt: new Date('2020-01-01'), baseEndAt: new Date('2020-01-02'), endAt: new Date('2020-01-02') } });
    await expect(cancelScheduleSlot(admin, await mutation(planId, 'Cancelar'), s.id)).rejects.toThrow('ya comenzó'); await expect(moveScheduleSlot(admin, await mutation(), { slotId: s.id, targetCollaboratorId: a, targetDate: '2090-10-05', mode: 'MOVER' })).rejects.toThrow('ya comenzó');
  });
  it('el historial global no revela mallas o colaboradores a roles sin acceso', async () => {
    expect(await prisma.auditLog.count({ where: { AND: [await scheduleAuditVisibility(reader)], entity: { startsWith: 'Schedule' } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { AND: [await scheduleAuditVisibility(admin)], entity: 'SchedulePlan' } })).toBeGreaterThan(0);
  });
  it('conserva acceso y nueva recepción al cancelar la última asignación propia', async () => {
    await add(); const assigned = await slot();
    await publishSchedulePlan(admin, await mutation(planId, 'Publicación'));
    await acknowledgeSchedule({ ...own, permissions: ['schedule.self.view'] }, planId, (await prisma.schedulePlan.findUniqueOrThrow({ where: { id: planId } })).publishedVersion!);
    await cancelScheduleSlot(admin, await mutation(planId, 'Retiro de asignación'), assigned.id);
    const mine = await getScheduleBoard({ ...own, permissions: ['schedule.self.view'] }, area, planId);
    expect(mine.slots).toHaveLength(0); expect(mine.acknowledgments[0]?.acknowledgedAt).toBeNull();
    expect((await getSchedulePlan({ ...own, permissions: ['schedule.self.view'] }, planId)).id).toBe(planId);
  });
  it('suma trabajo publicado de otras áreas sin exponer sus asignaciones', async () => {
    await add();
    const extraPlan = await createSchedulePlan(admin, { departmentId: other, startDate: '2090-10-01', endDate: '2090-10-08' });
    const t = await saveScheduleTemplate(admin, { departmentId: other, code: 'TEST_HSK', label: 'HSK', startTime: '19:00', endTime: '21:00', crossesMidnight: false });
    await addScheduleSlot(admin, { planId: extraPlan.id, version: extraPlan.version, requestKey: randomUUID(), reason: '' }, { collaboratorId: a, date: '2090-10-03', kind: 'TURNO', templateId: t.id });
    await publishSchedulePlan(admin, { planId: extraPlan.id, version: (await prisma.schedulePlan.findUniqueOrThrow({ where: { id: extraPlan.id } })).version, requestKey: randomUUID(), reason: 'Publicación otra área' });
    const board = await getScheduleBoard(admin, area, planId);
    expect(Object.values(board.totals).reduce((sum, n) => sum + n, 0)).toBe(780);
    expect(board.contextSlots.every((s) => s.planId === planId)).toBe(true);
  });

  it('no permite informar un extra propio de un borrador no publicado', async () => {
    await add(a, '2090-10-03', day, 'EXTENSION', 120); const s = await slot();
    await changeScheduleExtra(admin, await mutation(planId, 'Refuerzo'), { slotId: s.id, action: 'APROBAR' });
    await expect(changeScheduleExtra(own, await mutation(planId, 'Informe propio'), { slotId: s.id, action: 'REPORTAR', reportedMinutes: 120 })).rejects.toThrow('no existe');
  });

  it('rechazar un turno adicional libera la casilla y conserva su evidencia', async () => {
    await add(a, '2090-10-03', day, 'TURNO_EXTRA'); const s = await slot();
    await changeScheduleExtra(admin, await mutation(planId, 'Refuerzo innecesario'), { slotId: s.id, action: 'RECHAZAR' });
    const rejected = await prisma.scheduleSlot.findUniqueOrThrow({ where: { id: s.id } });
    expect(rejected.extraStatus).toBe('RECHAZADO'); expect(rejected.cancelledAt).not.toBeNull();
    await add(); expect((await getScheduleBoard(admin, area, planId)).slots).toHaveLength(1);
  });
  it('rechazar extensión conserva horario base y libera minutos adicionales', async () => {
    await add(a, '2090-10-03', day, 'EXTENSION', 120); const s = await slot();
    await changeScheduleExtra(admin, await mutation(planId, 'Extensión innecesaria'), { slotId: s.id, action: 'RECHAZAR' });
    const rejected = await slot(); expect(rejected.endAt).toEqual(rejected.baseEndAt); expect(rejected.extraMinutes).toBe(120);
    expect(Object.values((await getScheduleBoard(admin, area, planId)).totals).reduce((sum, n) => sum + n, 0)).toBe(660);
  });

  it('Fronti usa permisos canónicos y no revela horarios ajenos a la consulta propia', async () => {
    await add(); await add(b); await publishSchedulePlan(admin, await mutation(planId, 'Malla revisada'));
    const page = resolveFrontiPageContext({ pathname: '/equipo', search: `?area=${area}&malla=${planId}` });
    await expect(executeFrontiPageContextTool(reader, page)).rejects.toThrow('no está habilitado');
    const response = await executeFrontiPageContextTool(own, page) as { snapshot: { assignments: { collaborator: string }[] } };
    expect(response.snapshot.assignments).toHaveLength(1); expect(response.snapshot.assignments[0]?.collaborator).toBe('Colaborador Uno');
  });

  it('rechaza una malla que pertenece a otra área en vez de mezclar sus datos', async () => {
    await expect(getScheduleBoard(admin, other, planId)).rejects.toThrow();
    expect((await getScheduleBoard(admin, other)).selected).toBeNull();
  });

  it('elige por defecto la malla vigente o la futura más cercana', async () => {
    await createSchedulePlan(admin, { departmentId: area, startDate: '2090-10-09', endDate: '2090-10-16' });
    expect((await getScheduleBoard(admin, area)).selected?.id).toBe(planId);
  });

  it.each(['inactiva', 'oculta', 'eliminada', 'no operativa', 'perfil inactivo', 'sin pertenencia'] as const)('aplica elegibilidad única a cuenta %s en creación, movimiento, publicación y cobertura', async state => {
    await add(a, '2090-10-03');
    await add(b, '2090-10-05');
    await saveScheduleCoverage(admin, { departmentId: area, name: 'TEST_COBERTURA', weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '19:00', crossesMidnight: false, minimum: 1 });
    if (state === 'inactiva') await prisma.user.update({ where: { id: own.id }, data: { active: false } });
    if (state === 'oculta') await prisma.user.update({ where: { id: own.id }, data: { hiddenFromSelectors: true } });
    if (state === 'eliminada') await prisma.user.update({ where: { id: own.id }, data: { deletedAt: new Date() } });
    if (state === 'no operativa') {
      nonOperationalRoleId = (await prisma.role.create({ data: { key: `TEST_NO_OPERATIVO_${randomUUID()}`, name: 'Prueba no operativa', operational: false } })).id;
      await prisma.user.update({ where: { id: own.id }, data: { roleId: nonOperationalRoleId } });
    }
    if (state === 'perfil inactivo') await prisma.scheduleCollaborator.update({ where: { id: a }, data: { active: false } });
    if (state === 'sin pertenencia') await prisma.scheduleMembership.update({ where: { collaboratorId_departmentId: { collaboratorId: a, departmentId: area } }, data: { active: false } });
    const original = await slot(); const sourceB = await slot(b, '2090-10-05'); const version = (await mutation()).version;
    await expect(add(a, '2090-10-04')).rejects.toThrow('activo');
    await expect(moveScheduleSlot(admin, await mutation(), { slotId: original.id, targetCollaboratorId: a, targetDate: '2090-10-04', mode: 'MOVER' })).rejects.toThrow('habilitado');
    await expect(moveScheduleSlot(admin, await mutation(), { slotId: sourceB.id, targetCollaboratorId: a, targetDate: '2090-10-04', mode: 'REASIGNAR' })).rejects.toThrow('habilitado');
    await expect(publishSchedulePlan(admin, await mutation(planId, 'Prueba de publicación inválida'))).rejects.toThrow('no está habilitado');
    const board = await getScheduleBoard(admin, area, planId);
    expect(board.collaborators.some(p => p.id === a)).toBe(false);
    expect(board.slots.find(s => s.id === original.id)?.cancelledAt).toBeNull();
    expect(board.contextSlots.some(s => s.collaboratorId === a)).toBe(false);
    expect(board.gaps.find(g => g.date === '2090-10-03')?.scheduled).toBe(0);
    expect((await mutation()).version).toBe(version);
    // Resolving one invalid legacy assignment must remain possible.
    await moveScheduleSlot(admin, await mutation(), { slotId: original.id, targetCollaboratorId: b, targetDate: '2090-10-03', mode: 'REASIGNAR' });
    expect((await slot(b)).collaboratorId).toBe(b);
  });

  it('permite limpiar varias asignaciones de una cuenta deshabilitada sin restaurar su elegibilidad', async () => {
    await add(a, '2090-10-03'); await add(a, '2090-10-04');
    await prisma.user.update({ where: { id: own.id }, data: { active: false } });
    await cancelScheduleSlot(admin, await mutation(planId, 'Retiro de programación'), (await slot()).id);
    expect((await slot(a, '2090-10-04')).cancelledAt).toBeNull();
    await cancelScheduleSlot(admin, await mutation(planId, 'Retiro de programación restante'), (await slot(a, '2090-10-04')).id);
    const current = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: a } });
    await saveScheduleCollaborator(admin, { id: a, version: current.version, userId: own.id, departmentIds: [area], active: false });
    expect((await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: a } })).active).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: own.id } })).active).toBe(false);
  });

  it('rechaza mover fuera de periodo sin cancelar origen ni incrementar versión', async () => {
    await add(); const original = await slot(); const m = await mutation();
    await expect(moveScheduleSlot(admin, m, { slotId: original.id, targetCollaboratorId: a, targetDate: '2090-10-09', mode: 'MOVER' })).rejects.toThrow('fuera de la malla');
    expect((await slot()).id).toBe(original.id); expect((await mutation()).version).toBe(m.version);
  });

  it('retira sólo una pertenencia con permiso actual y conserva cuenta, principal, otras áreas e historial', async () => {
    const account = await prisma.user.findUniqueOrThrow({ where: { id: own.id } });
    const person = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: a } });
    const areaManager = { ...reader, departmentId: other, permissions: ['schedule.catalog.manage'] as CurrentUser['permissions'] };
    await expect(removeScheduleMembership(areaManager, { collaboratorId: a, departmentId: area, version: person.version, reason: 'Retiro de una pertenencia' })).rejects.toThrow('fuera de tu alcance');
    await removeScheduleMembership(areaManager, { collaboratorId: a, departmentId: other, version: person.version, reason: 'Retiro de una pertenencia' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: own.id } })).toEqual(account);
    expect(await prisma.scheduleMembership.findUniqueOrThrow({ where: { collaboratorId_departmentId: { collaboratorId: a, departmentId: other } } })).toMatchObject({ active: false });
    expect(await prisma.scheduleMembership.findUniqueOrThrow({ where: { collaboratorId_departmentId: { collaboratorId: a, departmentId: area } } })).toMatchObject({ active: true });
    const updated = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: a } });
    expect(updated.active).toBe(person.active); expect(updated.version).toBe(person.version + 1);
    expect(await prisma.auditLog.count({ where: { entity: 'ScheduleCatalog', entityId: other, reason: 'Retiro de una pertenencia' } })).toBe(1);
    // Editing global reference does not silently re-add the removed area.
    await saveScheduleCollaborator(admin, { id: a, version: updated.version, userId: own.id, departmentIds: [other], weeklyHours: 40 });
    expect(await prisma.scheduleMembership.findUniqueOrThrow({ where: { collaboratorId_departmentId: { collaboratorId: a, departmentId: other } } })).toMatchObject({ active: false });
  });

  it('retirar pertenencia bloquea asignaciones futuras y revisiones obsoletas', async () => {
    await add(); const p = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: a } });
    await expect(removeScheduleMembership(admin, { collaboratorId: a, departmentId: area, version: p.version, reason: 'Retiro solicitado' })).rejects.toThrow('futuras');
    await expect(removeScheduleMembership(admin, { collaboratorId: a, departmentId: other, version: p.version - 1, reason: 'Retiro solicitado' })).rejects.toThrow('cambió');
    expect(await prisma.scheduleMembership.count({ where: { collaboratorId: a, active: true } })).toBe(2);
  });

  it('importa la identidad literal descargada en fechas por columnas sin resolver homónimos por nombre', async () => {
    const accountB = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: b } });
    await prisma.user.update({ where: { id: accountB.userId! }, data: { name: own.name } });
    const board = await getScheduleBoard(admin, area, planId);
    const person = board.collaborators.find(person => person.id === a)!;
    const exportedIdentity = scheduleCsvTemplate([person]).split('\r\n')[1]!.split(';')[0]!;
    const csv = `ID_COLABORADOR;2090-10-03;2090-10-04\r\n${exportedIdentity};TEST_DIA;LIBRE\r\n`;
    const draft = await reviewScheduleImport(admin, planId, 'malla-columnas.csv', new TextEncoder().encode(csv));
    expect(draft.issues).toEqual([]);
    expect(draft.rows).toHaveLength(2);
    await applyScheduleImport(admin, await mutation(), draft.id);
    expect(await prisma.scheduleSlot.count({ where: { planId, collaboratorId: a, cancelledAt: null } })).toBe(2);
    expect(await prisma.scheduleSlot.count({ where: { planId, collaboratorId: b, cancelledAt: null } })).toBe(0);
  });

  it('CSV descargado contiene identidades visibles y permite homónimos con @usuario sin acceso técnico', async () => {
    const accountB = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: b } });
    await prisma.user.update({ where: { id: accountB.userId! }, data: { name: own.name } });
    const board = await getScheduleBoard(admin, area, planId);
    const ownAccount = await prisma.user.findUniqueOrThrow({ where: { id: own.id }, select: { username: true } });
    const csv = scheduleCsvTemplate(board.collaborators);
    expect(csv).toContain(`@${ownAccount.username}`); expect(csv).toContain('NOMBRE;FECHA');
    const lines = csv.trimEnd().split('\r\n');
    const completed = lines.map((line, i) => !i ? line : line.replace(/;"";"";"";""$/, `;"2090-10-0${i + 2}";"TEST_DIA";"08:00";"19:00"`)).join('\r\n');
    const draft = await reviewScheduleImport(admin, planId, 'plantilla.csv', new TextEncoder().encode(completed));
    expect(draft.issues).toEqual([]); expect(draft.rows).toHaveLength(2);
    await applyScheduleImport(admin, await mutation(), draft.id);
    expect(await prisma.scheduleSlot.count({ where: { planId, cancelledAt: null } })).toBe(2);
    const namesOnly = await reviewScheduleImport(admin, planId, 'nombres.csv', new TextEncoder().encode(`NOMBRE;FECHA;CODIGO\n${own.name};2090-10-06;LIBRE\n`));
    expect(JSON.stringify(namesOnly.issues)).toContain('homónimos');
    const catalog = await getScheduleCatalog(admin, area);
    expect(catalog.collaborators.find(p => p.id === a)?.username).toBe(ownAccount.username);
  });

});
