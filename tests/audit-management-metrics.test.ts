import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/server/auth/current-user';
import { createShift, createUser, prisma, resetOperationalData, seedCatalog, ROLE_KEYS } from './helpers';
import { getMetrics, defaultRange, getShiftMetrics } from '@/server/services/metrics';
import { getManagementCockpit, getManagementDecisionAdvice } from '@/server/services/management';
import { getManagementEvidence, getManagementKeyEvidence } from '@/server/services/management-evidence';
import { metricPeriod } from '@/domain/operational-metrics';
import { hotelCalendarDate } from '@/domain/time';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';
import { executeFrontiPageContextTool } from '@/server/ai/fronti-v2/page-context-tool';

const now = new Date('2026-10-05T17:00:00Z');
const hour = 3600000;
describe('auditoría F01 F03 F08 F09 F10 · métricas verificables', () => {
  let manager: CurrentUser;
  beforeAll(seedCatalog);
  beforeEach(async () => {
    await resetOperationalData();
    manager = await createUser({ roleKey: ROLE_KEYS.MANAGEMENT });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it('declara alcance por acceso para numeradores filtrados y hotel para turnos/entregas',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const other=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});const hiddenArea=await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}});const visibleArea=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});await prisma.user.update({where:{id:manager.id},data:{departmentId:hiddenArea.id}});manager.departmentId=hiddenArea.id;await prisma.user.update({where:{id:other.id},data:{departmentId:visibleArea.id}});other.departmentId=visibleArea.id;const shift=await createShift({userId:admin.id,type:'DIA',status:'CERRADO'});await prisma.shiftHandover.create({data:{fromShiftId:shift.id,issuedById:admin.id,status:'ENVIADA',issuedAt:now}});const entry=await prisma.operationalEntry.create({data:{createdById:admin.id,type:'INCIDENCIA',title:'Origen reservado por área',description:'Métrica filtrada',priority:'CRITICA',shiftId:shift.id,occurredAt:now,hiddenFromDepartments:{connect:{id:hiddenArea.id}}}});await prisma.task.create({data:{createdById:admin.id,title:'Trabajo de origen reservado',entryId:entry.id}});await prisma.operationalAlarm.create({data:{kind:'RECORDATORIO',scope:'GLOBAL',title:'Alarma del origen reservado',createdById:admin.id,dueAt:now,sourceEntity:'OperationalEntry',sourceId:entry.id}});
    const [a,b,ma,mb]=await Promise.all([getMetrics(defaultRange(7),manager),getMetrics(defaultRange(7),other),getManagementCockpit(manager,7),getManagementCockpit(other,7)]);expect(a.tasks.open).toBe(0);expect(b.tasks.open).toBe(1);expect(a.incidents.open).toBe(0);expect(b.incidents.open).toBe(1);expect(a.alerts.live).toBe(0);expect(b.alerts.live).toBe(1);expect(a.volumeByShift).toHaveLength(0);expect(b.volumeByShift.reduce((sum,row)=>sum+row.count,0)).toBe(1);expect(a.handovers).toEqual(b.handovers);expect(a.handovers.sent).toBe(1);expect(a.shifts).toEqual(b.shifts);expect(a.shifts.total).toBe(1);expect(ma.execution.criticalOpenIncidents).toBe(0);expect(mb.execution.criticalOpenIncidents).toBe(1);expect(ma.execution.handoversSent).toBe(mb.execution.handoversSent);for(const result of [a,b,ma,mb]){expect(result.scopes.operational).toContain('acceso vigente del lector');expect(result.scopes.shifts).toContain('totales del hotel');expect(result.scope).toContain(result.scopes.operational);expect(result.scope).toContain(result.scopes.shifts);}
  });

  it('COMPLETADA y VALIDADA equivalentes en Indicadores, Gerencia y turno, con reserva idéntica', async () => {
    const shift = await createShift({ type: 'DIA', userId: manager.id });
    const end = new Date(now.getTime() - hour);
    for (const status of ['COMPLETADA', 'VALIDADA', 'REALIZADA', 'CANCELADA'] as const) {
      await prisma.task.create({ data: { title: status, createdById: manager.id, status, completedAt: end, dueAt: now, shiftId: shift.id } });
    }
    await prisma.task.create({ data: { title: 'Sin fecha histórica', createdById: manager.id, status: 'VALIDADA', shiftId: shift.id } });
    const privateOrigin = await prisma.followUp.create({ data: { action: 'Reservado propio', visibility: 'PRIVADO', createdById: manager.id, ownerId: manager.id } });
    await prisma.task.create({ data: { title: 'Privada propia terminada', createdById: manager.id, followUpId: privateOrigin.id, status: 'VALIDADA', completedAt: end, dueAt: now, shiftId: shift.id } });
    const metrics = await getMetrics(defaultRange(7));
    const cockpit = await getManagementCockpit(manager, 7);
    expect(metrics.tasks).toMatchObject({ completed: 2, completedOnTime: 2, onTimeRate: 100, withoutCompletionDate: 1 });
    expect(cockpit.execution).toMatchObject({ tasksCompleted: 2, tasksOnTime: 2, taskOnTimeRate: 100, tasksWithoutDate: 1 });
    expect((await getShiftMetrics(shift.id)).tasksCompleted).toBe(3);
    expect(cockpit.scope).toBe(metrics.scope);
  });

  it('distingue resolución de cierre, mantiene fallback histórico y declara fechas faltantes', async () => {
    for (const [title, status, resolvedHours, closedHours] of [
      ['Resuelta', 'RESUELTO', 1, null], ['Cerrada tras resolver', 'CERRADO', 2, 6],
      ['Cierre histórico', 'CERRADO', null, 4], ['Resuelta sin fecha', 'RESUELTO', null, null],
    ] as const) {
      const start = new Date(now.getTime() - 8 * hour);
      await prisma.operationalEntry.create({ data: { title, type: 'INCIDENCIA', status, description: 'Prueba sintética', createdById: manager.id, occurredAt: start, resolvedAt: resolvedHours === null ? null : new Date(start.getTime() + resolvedHours * hour), closedAt: closedHours === null ? null : new Date(start.getTime() + closedHours * hour) } });
    }
    const metrics = await getMetrics(defaultRange(7));
    const cockpit = await getManagementCockpit(manager, 7);
    expect(metrics.incidents).toMatchObject({ open: 0, resolvedInRange: 3, closedInRange: 2, historicalClosureSamples: 1, withoutResolutionDate: 1, resolutionSamples: 3 });
    expect(metrics.incidents.avgResolutionHours).toBeCloseTo(7 / 3);
    expect(cockpit.execution.incidentAvgResolutionHours).toBe(metrics.incidents.avgResolutionHours);
    expect(cockpit.execution.incidentsWithoutDate).toBe(1);
  });

  it.each([7, 30, 90])('comparte los extremos de %i días y usa fecha calendario de turno', async days => {
    const range = metricPeriod(days, now).current;
    for (const [index, completedAt] of [new Date(range.from.getTime() - 1), range.from, now, new Date(now.getTime() + 1)].entries()) {
      await prisma.task.create({ data: { title: `Borde ${index}`, createdById: manager.id, status: 'COMPLETADA', completedAt } });
    }
    await prisma.shift.create({ data: { type: 'DIA', date: hotelCalendarDate(range.from), status: 'CERRADO', plannedStart: range.from, plannedEnd: new Date(range.from.getTime() + 12 * hour) } });
    const metrics = await getMetrics(defaultRange(days)); const cockpit = await getManagementCockpit(manager, days);
    expect(metrics.range).toEqual(cockpit.period.current);
    expect(metrics.tasks.completed).toBe(2); expect(cockpit.execution.tasksCompleted).toBe(2);
    expect(metrics.shifts).toMatchObject({ total: 1, closed: 1 }); expect(cockpit.execution.shiftsTotal).toBe(1);
  });

  it('cuenta 31 excepciones por clase y 205 arqueos completos; expone las ocho decisiones y todas las páginas', async () => {
    const room = await prisma.room.findFirstOrThrow({ where: { floor: 4 } });
    const dueAt = new Date(now.getTime() - hour);
    await prisma.task.createMany({ data: Array.from({ length: 31 }, (_, i) => ({ title: `Vencida ${i}`, createdById: manager.id, dueAt, roomId: room.id })) });
    await prisma.operationalEntry.createMany({ data: Array.from({ length: 31 }, (_, i) => ({ title: `Crítica ${i}`, description: 'Sintética', type: 'INCIDENCIA' as const, priority: 'CRITICA' as const, createdById: manager.id, roomId: room.id })) });
    const template = await prisma.checklistTemplate.create({ data: { name: 'Auditoría sintética', createdById: manager.id } });
    const audit = await prisma.checklistRun.create({ data: { templateId: template.id, templateName: template.name, runById: manager.id } });
    await prisma.auditFinding.createMany({ data: Array.from({ length: 31 }, (_, i) => ({ title: `Hallazgo ${i}`, description: 'Sintético', auditId: audit.id, confirmed: true, severity: 'CRITICA' as const })) });
    await prisma.correctiveMeasure.createMany({ data: Array.from({ length: 31 }, (_, i) => ({ title: `Correctiva ${i}`, action: 'Revisar', assigneeId: manager.id, createdById: manager.id, dueAt })) });
    await prisma.cashAudit.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ id: `audit-${i}`, currency: 'CLP', expectedAmount: 100, countedAmount: i === 0 ? 150 : i === 1 ? 50 : 100, difference: i === 0 ? 50 : i === 1 ? -50 : 0, countedById: manager.id, createdAt: new Date(now.getTime() - (205 - i) * 60000) })) });
    await prisma.keyInventoryCount.create({ data: { floor: 4, countedById: manager.id, items: { create: { roomId: room.id, expected: 3, found: 1, outOfService: 1 } } } });
    const shift = await createShift({ type: 'DIA', userId: manager.id });
    await prisma.shiftHandover.create({ data: { fromShiftId: shift.id, issuedById: manager.id, status: 'ENVIADA', issuedAt: dueAt } });
    const cockpit = await getManagementCockpit(manager, 7);
    expect(cockpit.execution).toMatchObject({ overdueTasks: 31, criticalOpenIncidents: 31 });
    expect(cockpit.controls).toMatchObject({ criticalFindings: 31, correctiveOverdue: 31, cashAudits: 205, cashDifferences: 2, cashDifferenceByCurrency: [{ currency: 'CLP', amount: 100, netAmount: 0 }] });
    expect(cockpit.decisions).toHaveLength(8);
    for (const kind of ['tasks-overdue', 'critical-incidents', 'critical-findings', 'corrective-overdue']) {
      const decision = cockpit.decisions.find(row => row.id === kind)!;
      expect(decision.evidence).toHaveLength(5); expect(decision.evidenceTotal).toBe(31);
      const first = await getManagementEvidence(manager, { kind, days: 7, page: 1 });
      const last = await getManagementEvidence(manager, { kind, days: 7, page: 2 });
      expect(first).toMatchObject({ total: 31, hasMore: true }); expect(first!.rows).toHaveLength(30);
      expect(last).toMatchObject({ total: 31, hasMore: false }); expect(last!.rows).toHaveLength(1);
      expect(new Set([...first!.rows, ...last!.rows].map(row => row.id)).size).toBe(31);
    }
    const cash = cockpit.decisions.find(row => row.id === 'cash-differences')!;
    expect(cash.evidence.map(row => row.label).join(' ')).toContain('CLP -50');
    expect(cash.evidence.map(row => row.label).join(' ')).toContain('CLP +50');
    expect(await getManagementDecisionAdvice([cash])).toEqual({ 'cash-differences': cash.action });
  });

  it('cero no crea señal y cada moneda conserva su saldo sin compensación cruzada', async () => {
    const create = async (id: string, currency: string, difference: number) => prisma.cashAudit.create({ data: { id, currency, difference, expectedAmount: 100, countedAmount: 100 + difference, countedById: manager.id, createdAt: new Date(now.getTime() - hour) } });
    await create('zero', 'CLP', 0);
    const zero = await getManagementCockpit(manager, 7);
    expect(zero.controls).toMatchObject({ cashAudits: 1, cashDifferences: 0, cashDifferenceByCurrency: [] });
    expect(zero.decisions.some(row => row.id === 'cash-differences')).toBe(false);
    await create('clp-negative', 'CLP', -50); await create('usd-positive', 'USD', 50);
    const mixed = await getManagementCockpit(manager, 7);
    expect(mixed.controls.cashDifferenceByCurrency).toEqual(expect.arrayContaining([{ currency: 'CLP', amount: 50, netAmount: -50 }, { currency: 'USD', amount: 50, netAmount: 50 }]));
    const evidence = await getManagementEvidence(manager, { kind: 'cash-differences', days: 7 });
    expect(evidence?.total).toBe(2);
    expect(evidence?.rows.map(row => row.label).join(' ')).toContain('CLP -50');
    expect(evidence?.rows.map(row => row.label).join(' ')).toContain('USD +50');
  });

  it('evidencia de llaves respeta piso y snapshot sin permiso operativo, y rechaza un lector ajeno', async () => {
    const room = await prisma.room.findFirstOrThrow({ where: { floor: 4 } });
    const snapshot = await prisma.keyInventoryCount.create({ data: { floor: 4, countedById: manager.id, countedAt: new Date(now.getTime() - hour), items: { create: { roomId: room.id, expected: 3, found: 1, outOfService: 1 } } } });
    await prisma.keyInventoryCount.create({ data: { floor: 4, countedById: manager.id, items: { create: { roomId: room.id, expected: 3, found: 3 } } } });
    expect(manager.permissions).not.toContain('key.inventory');
    const result = await getManagementKeyEvidence(manager, { floor: 4, countId: snapshot.id });
    expect(result[0]).toMatchObject({ id: snapshot.id, floor: 4, items: [{ found: 1 }] });
    expect(await getManagementKeyEvidence(manager, { floor: 5, countId: snapshot.id })).toEqual([null]);
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    expect((await getManagementKeyEvidence(admin, { floor: 4, countId: snapshot.id }))[0]?.id).toBe(snapshot.id);
    const unauthorized = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await expect(getManagementKeyEvidence(unauthorized, { floor: 4 })).rejects.toThrow('permiso');
    await expect(getManagementEvidence(unauthorized, { kind: 'tasks-overdue' })).rejects.toThrow('permiso');
  });

  it('Fronti recibe hechos firmados de Gerencia, diferencia absoluta vs neta y causa no acreditada', async () => {
    await prisma.cashAudit.create({ data: { id: 'negative-audit', currency: 'CLP', expectedAmount: 100, countedAmount: 50, difference: -50, countedById: manager.id, createdAt: new Date(now.getTime() - hour) } });
    const result = await executeFrontiPageContextTool(manager, resolveFrontiPageContext({ pathname: '/gerencia', search: '?dias=7' })) as { snapshot: Awaited<ReturnType<typeof getManagementCockpit>>; guidance: string };
    expect(result.snapshot.period.days).toBe(7);
    expect(result.snapshot.decisions[0]!.evidence[0]!.label).toContain('CLP -50');
    expect(result.snapshot.controls.cashDifferenceByCurrency).toEqual([{ currency: 'CLP', amount: 50, netAmount: -50 }]);
    expect(result.guidance).toContain('no atribuir ajustes');
    expect(result.guidance).toContain('Hipótesis');
  });
});
