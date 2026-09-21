import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, prisma, resetOperationalData, seedCatalog, ROLE_KEYS, openShiftAs } from './helpers';
import * as center from '@/server/services/supervision-center';
import { changeTaskStatus } from '@/server/services/tasks';

describe('Centro privado de Supervisión', () => {
  beforeAll(seedCatalog);
  beforeEach(resetOperationalData);
  const supervisor = () => createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  const receptionist = () => createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  const taskInput = (assigneeId: string) => ({ title: 'Verificar garantía', description: 'Revisar comprobante', acceptanceCriteria: 'Comprobante conciliado', assigneeId, collaboratorIds: [], priority: 'ALTA' as const, dueAt: new Date(Date.now() + 3600000), evidenceRequired: true });

  it('deniega el centro a Recepción y el turno al Administrador', async () => {
    const r = await receptionist();
    const a = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    await expect(center.getSupervisionCenter(r)).rejects.toThrow();
    await expect(center.startSupervisionShift(a, 'Revisar')).rejects.toThrow();
  });
  it('impide dos turnos propios concurrentes y permite dos supervisores', async () => {
    const s = await supervisor();
    const other = await supervisor();
    const results = await Promise.allSettled([center.startSupervisionShift(s, 'Uno'), center.startSupervisionShift(s, 'Dos')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await expect(center.startSupervisionShift(other, 'Otro')).resolves.toBeTruthy();
  });
  it('entrega, conserva copia inmutable, finaliza y no altera Recepción', async () => {
    const s = await supervisor(); const r = await receptionist();
    const reception = await openShiftAs(r);
    const shift = await center.startSupervisionShift(s, 'Validar cierres');
    await expect(center.finishSupervisionShift(s, shift.id)).rejects.toThrow();
    const delivery = await center.handoverSupervisionShift(s, shift.id, 'Continúa revisión');
    await expect(prisma.supervisionHandover.update({ where: { id: delivery.id }, data: { note: 'Cambio' } })).rejects.toThrow();
    await center.finishSupervisionShift(s, shift.id);
    const unchanged = await prisma.shift.findUniqueOrThrow({ where: { id: reception.id } });
    expect(unchanged.status).toBe(reception.status);
    expect((await prisma.supervisionShift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe('FINALIZADO');
  });
  it('no filtra notas privadas ni su texto en la auditoría técnica o entrega', async () => {
    const s = await supervisor(); const other = await supervisor();
    const a = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const note = await center.createSupervisionNote(s, { title: 'Reservado', body: 'contenido-sensible-único', visibility: 'PRIVADO', priority: 'MEDIA' });
    await expect(center.readSupervisionNote(other, note.id)).rejects.toThrow();
    await expect(center.readSupervisionNote(a, note.id)).rejects.toThrow();
    await center.readSupervisionNote(a, note.id, 'Incidente técnico solicitado');
    const logs = await prisma.auditLog.findMany({ where: { entityId: note.id } });
    expect(JSON.stringify(logs)).not.toContain('contenido-sensible-único');
    expect(logs.some(l => l.reason === 'Incidente técnico solicitado')).toBe(true);
    const shift = await center.startSupervisionShift(s, 'Revisar');
    const delivery = await center.handoverSupervisionShift(s, shift.id, 'Entrega');
    expect(JSON.stringify(delivery.snapshot)).not.toContain(note.body);
  });
  it('conserva el seguimiento compartido en la entrega y sus versiones', async () => {
    const s = await supervisor(); const other = await supervisor();
    const note = await center.createSupervisionNote(s, { title: 'Revisar', body: 'Versión uno', visibility: 'SUPERVISION', priority: 'ALTA', nextReviewAt: new Date() });
    const shift = await center.startSupervisionShift(s, 'Revisar');
    const delivery = await center.handoverSupervisionShift(s, shift.id, 'Seguimiento');
    await center.updateSupervisionNote(s, note.id, { title: note.title, body: 'Versión dos', visibility: 'SUPERVISION', nextReviewAt: null, resolution: 'Resuelto' });
    expect(JSON.stringify(delivery.snapshot)).toContain('Versión uno');
    expect((await center.readSupervisionNote(other, note.id)).revisions).toHaveLength(2);
  });
  it('excluye al Administrador como responsable y colaborador', async () => {
    const s = await supervisor(); const a = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const r = await receptionist();
    await expect(center.createSupervisedTask(s, taskInput(a.id))).rejects.toThrow();
    await expect(center.createSupervisedTask(s, { ...taskInput(r.id), collaboratorIds: [a.id] })).rejects.toThrow();
  });
  it('separa ejecución, evidencia, devolución y validación', async () => {
    const s = await supervisor(); const r = await receptionist(); const other = await receptionist();
    const t = await center.createSupervisedTask(s, taskInput(r.id));
    await expect(changeTaskStatus(other, { id: t.id, status: 'REALIZADA' })).rejects.toThrow();
    await changeTaskStatus(r, { id: t.id, status: 'ACEPTADA' });
    await expect(changeTaskStatus(r, { id: t.id, status: 'REALIZADA' })).rejects.toThrow();
    await center.saveTaskEvidence(r, t.id, 'Comprobante 123 verificado');
    await changeTaskStatus(r, { id: t.id, status: 'REALIZADA' });
    await expect(changeTaskStatus(r, { id: t.id, status: 'VALIDADA' })).rejects.toThrow();
    await changeTaskStatus(s, { id: t.id, status: 'DEVUELTA', reason: 'Falta segunda comprobación' });
    await changeTaskStatus(r, { id: t.id, status: 'REALIZADA' });
    await changeTaskStatus(s, { id: t.id, status: 'VALIDADA' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).validatedById).toBe(s.id);
  });
  it('audita sin notificar al equipo y convierte hallazgos cerrados en medidas', async () => {
    const s = await supervisor(); const r = await receptionist();
    const template = await center.createInspectionTemplate(s, { name: 'Garantías', area: 'Garantías', points: ['Comprobante vigente'] });
    const inspection = await center.startInspection(s, { templateId: template.id, title: 'Control', scope: 'Garantías vigentes', sample: 'Una reserva', reviewedPeople: [r.id], reviewedShifts: [] });
    expect(await prisma.notification.count()).toBe(0);
    await expect(center.closeInspection(s, inspection.id, 'Incompleto', 'PRIVADO')).rejects.toThrow();
    const point = await prisma.inspectionPoint.findFirstOrThrow({ where: { inspectionId: inspection.id } });
    await center.updateInspectionPoint(s, point.id, { result: 'INCUMPLIMIENTO', observation: 'Falta comprobante', evidence: 'Reserva verificada', severity: 'ALTA' });
    await center.closeInspection(s, inspection.id, 'Requiere corrección', 'PRIVADO');
    const measure = await center.createCorrectiveMeasure(s, { pointId: point.id, title: 'Completar garantía', instruction: 'Registrar comprobante', criteria: 'Comprobante revisado', assigneeId: r.id, dueAt: new Date() });
    expect(measure.taskId).toBeTruthy();
  });
  it('calcula indicadores explicables y restringe su acceso', async () => {
    const s = await supervisor(); const r = await receptionist();
    const t = await center.createSupervisedTask(s, { ...taskInput(r.id), evidenceRequired: false });
    await changeTaskStatus(r, { id: t.id, status: 'REALIZADA' });
    await changeTaskStatus(s, { id: t.id, status: 'VALIDADA' });
    const start = new Date(Date.now() - 86400000), end = new Date(Date.now() + 86400000);
    const result = await center.getTeamPerformance(s, r.id, start, end);
    expect(result.denominator).toBe(1); expect(result.validated).toBe(1); expect(result.onTime).toBe(1);
    expect(result.tasks[0]?.id).toBe(t.id); expect(result.formula).toContain('vencimiento');
    await expect(center.getTeamPerformance(r, r.id, start, end)).rejects.toThrow();
  });
  it('elimina lógicamente y restaura sin perder versiones', async () => {
    const s = await supervisor(); const a = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const note = await center.createSupervisionNote(s, { title: 'Nota', body: 'Conservar', visibility: 'PRIVADO', priority: 'MEDIA' });
    await center.archiveSupervisionRecord(s, 'SupervisionNote', note.id, 'Registro equivocado');
    expect((await prisma.supervisionNote.findUniqueOrThrow({ where: { id: note.id } })).deletedAt).toBeTruthy();
    await center.archiveSupervisionRecord(a, 'SupervisionNote', note.id, 'Restauración solicitada', true);
    expect((await center.readSupervisionNote(s, note.id)).revisions).toHaveLength(1);
  });
});
