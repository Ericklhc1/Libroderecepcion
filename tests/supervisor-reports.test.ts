import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Priority } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  createShift,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {reviewShiftClosure,listPendingClosureReviews} from '@/server/services/closure-review';
import { createTask } from '@/server/services/tasks';
import { buildSupervisorReport, reportDateRange } from '@/server/services/supervisor-reports';

describe('informes de Supervisión', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('separa actividad del período de pendientes que siguen vigentes', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisión informes',
    });
    const task = await createTask(supervisor, {
      title: 'Pendiente antiguo todavía vigente',
      priority: Priority.ALTA,
      checklist: [],
      tags: [],
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { createdAt: new Date('2026-09-01T12:00:00.000Z') },
    });

    const report = await buildSupervisorReport(
      supervisor,
      'estado',
      reportDateRange('2026-09-27', '2026-09-27'),
    );

    expect(report.title).toBe('Informe de actividad y estado operativo');
    expect(report.summary).toContain('Actividad del período · tareas creadas: 0');
    expect(
      report.summary.some((line) =>
        line.includes('Estado vigente ahora') && line.includes('tareas abiertas 1'),
      ),
    ).toBe(true);
    expect(report.lines).toContain('ESTADO VIGENTE AHORA');
  });
  it('las señales históricas de validación no cuentan como alertas activas y quedan intactas al validar',async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});const reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const shift=await createShift({userId:reception.id,type:'DIA'});const closed=await prisma.shift.update({where:{id:shift.id},data:{status:'CERRADO',actualEnd:new Date(),closedById:reception.id}});
    const legacy=await prisma.alert.create({data:{type:'OTRO',level:'CRITICA',title:'Validar cierre de turno',dedupeKey:`shift-validation:${shift.id}`}});
    await prisma.alert.create({data:{type:'OTRO',level:'CRITICA',title:'Alerta operativa vigente'}});
    const range=reportDateRange('2026-10-02','2026-10-02');
    expect((await listPendingClosureReviews(supervisor)).map(row=>row.id)).toContain(shift.id);
    for(const validated of [false,true]){
      if(validated)await reviewShiftClosure(supervisor,{shiftId:shift.id,decision:'VALIDADA',note:'Evidencia revisada en prueba sintética',revision:closed.updatedAt.toISOString()});
      const report=await buildSupervisorReport(supervisor,'estado',range);
      expect(report.summary.find(line=>line.includes('Estado vigente ahora'))).toContain('alertas activas 1');
      expect(await prisma.alert.findUnique({where:{id:legacy.id}})).toEqual(legacy);
    }
    expect((await listPendingClosureReviews(supervisor)).map(row=>row.id)).not.toContain(shift.id);
  });

});
