import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, seedCatalog, resetOperationalData, createUser, createShift, ROLE_KEYS } from './helpers';
import { getChangesSinceLastShift } from '@/server/services/shift-changes';
import { summarizeShiftChange, shiftChangeResultLabel } from '@/domain/shift-changes';
import type { CurrentUser } from '@/server/auth/current-user';
const at=(hours:number)=>new Date(`2026-10-05T${String(hours).padStart(2,'0')}:00:00Z`);
describe('resumen determinista desde último turno real',()=>{
  let reader:CurrentUser,other:CurrentUser;
  beforeAll(seedCatalog);
  beforeEach(async()=>{await resetOperationalData();reader=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});other=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});});
  async function previous(user:CurrentUser=reader){
    const shift=await createShift({type:'NOCHE',userId:user.id,status:'CERRADO'});
    await prisma.shiftAssignment.updateMany({where:{shiftId:shift.id,userId:user.id},data:{activatedAt:at(7),leftAt:at(9)}});
    return shift;
  }
  it('no inventa un turno previo desde horario programado ni inicio sin terminar',async()=>{
    await createShift({type:'DIA',userId:reader.id,status:'PROGRAMADO'});
    const summary=await getChangesSinceLastShift(reader,1,at(18));
    expect(summary.baseline).toBeNull();expect(summary.groups).toEqual([]);
  });
  it('usa el fin real propio y separa pendientes, responsable y resultado con fuente',async()=>{
    await previous();
    const pending=await prisma.task.create({data:{title:'Pendiente nuevo',createdById:reader.id,createdAt:at(10),updatedAt:at(10)}});
    const result=await prisma.task.create({data:{title:'Resultado nuevo',createdById:reader.id,assigneeId:other.id,status:'COMPLETADA',completedAt:at(12),evidenceProvided:'Resultado registrado',createdAt:at(8),updatedAt:at(12),workAssignedAt:at(11)}});
    const summary=await getChangesSinceLastShift(reader,1,at(18));
    expect(summary.baseline?.at).toEqual(at(9));
    const rows=summary.groups.find(group=>group.key==='tasks')!.items;
    expect(rows.find(row=>row.id===pending.id)?.labels).toContain('Nuevo pendiente');
    expect(rows.find(row=>row.id===result.id)).toMatchObject({href:`/tareas/${result.id}`,owner:other.name,result:'Resultado registrado',labels:['Responsable actualizado','Resultado registrado']});
  });
  it('el conteo excluye privados ajenos, derivados, demo y borrados',async()=>{
    await previous();
    const privateFollow=await prisma.followUp.create({data:{action:'Privado ajeno',visibility:'PRIVADO',createdById:other.id,ownerId:reader.id,createdAt:at(10),updatedAt:at(10)}});
    await prisma.task.create({data:{title:'Derivado reservado',createdById:reader.id,followUpId:privateFollow.id,createdAt:at(10),updatedAt:at(10)}});
    await prisma.task.createMany({data:[{title:'Demo',createdById:reader.id,isDemo:true,createdAt:at(10),updatedAt:at(10)},{title:'Borrado',createdById:reader.id,deletedAt:at(11),createdAt:at(10),updatedAt:at(10)}]});
    const summary=await getChangesSinceLastShift(reader,1,at(18));
    expect(summary.groups.reduce((sum,group)=>sum+group.total,0)).toBe(0);
    expect(JSON.stringify(summary)).not.toContain('Privado ajeno');
  });
  it('paginar no convierte una muestra en total ni repite fuentes',async()=>{
    await previous();
    await prisma.task.createMany({data:Array.from({length:21},(_,i)=>({title:`Cambio ${i}`,createdById:reader.id,createdAt:at(10),updatedAt:at(11)}))});
    const first=(await getChangesSinceLastShift(reader,1,at(18))).groups.find(group=>group.key==='tasks')!;
    const second=(await getChangesSinceLastShift(reader,2,at(18))).groups.find(group=>group.key==='tasks')!;
    expect(first.total).toBe(21);expect(second.total).toBe(21);expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(1);
    expect(new Set([...first.items,...second.items].map(row=>row.id)).size).toBe(21);
  });
  it('elige Supervisión sólo cuando terminó después de la propia participación',async()=>{
    await previous();
    await prisma.supervisionShift.create({data:{supervisorId:reader.id,status:'CERRADO',startedAt:at(10),finishedAt:at(12)}});
    expect((await getChangesSinceLastShift(reader,1,at(18))).baseline?.at).toEqual(at(12));
  });
  it('un perfil HK no recibe tareas genéricas ni enlaces de seguimientos inaccesibles',async()=>{
    const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});await previous(maid);
    await prisma.task.create({data:{title:'Tarea legada HK',createdById:reader.id,assigneeId:maid.id,createdAt:at(10),updatedAt:at(10)}});
    await prisma.followUp.create({data:{action:'Seguimiento legado HK',createdById:maid.id,ownerId:maid.id,createdAt:at(10),updatedAt:at(10)}});
    const summary=await getChangesSinceLastShift(maid,1,at(18));
    expect(summary.groups.filter(group=>['tasks','followups','entries'].includes(group.key)).every(group=>group.total===0)).toBe(true);
  });
  it('un seguimiento cumplido nuevo no reaparece como pendiente',async()=>{
    await previous();
    const follow=await prisma.followUp.create({data:{action:'Continuidad cumplida',createdById:reader.id,ownerId:reader.id,status:'CUMPLIDO',result:'Atendido',createdAt:at(10),completedAt:at(12),updatedAt:at(12)}});
    const item=(await getChangesSinceLastShift(reader,1,at(18))).groups.find(group=>group.key==='followups')!.items.find(row=>row.id===follow.id)!;
    expect(item.labels).toEqual(['Resultado registrado']);
  });
  it('conserva el intento devuelto sin presentarlo como resultado vigente',async()=>{
    await previous();
    const task=await prisma.task.create({data:{title:'Resultado devuelto',createdById:reader.id,assigneeId:other.id,status:'DEVUELTA',completedAt:at(12),evidenceProvided:'Primer intento',returnReason:'Revisar la reparación',createdAt:at(8),updatedAt:at(14)}});
    const item=(await getChangesSinceLastShift(reader,1,at(18))).groups.find(group=>group.key==='tasks')!.items.find(row=>row.id===task.id)!;
    expect(item.result).toBe('Primer intento');
    expect(item.resultLabel).toBe('Último intento histórico');
    expect(item.labels).not.toContain('Resultado registrado');
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).evidenceProvided).toBe('Primer intento');
  });
  it.each(['REALIZADA','POR_REVISAR'])('distingue resultado pendiente de revisión en %s',status=>{
    expect(shiftChangeResultLabel(status)).toBe('Resultado por revisar');
    expect(summarizeShiftChange({createdAt:at(8),updatedAt:at(12),completedAt:at(12),status},at(9))).toEqual(['Resultado por revisar']);
  });
  it('la cancelación de Housekeeping no acredita resultado exitoso',()=>{
    expect(summarizeShiftChange({createdAt:at(8),updatedAt:at(12),completedAt:at(12),status:'CANCELADO'},at(9))).toEqual(['Estado final actualizado']);
  });
  it('no etiqueta finalizaciones nuevas como pendientes',()=>{
    expect(summarizeShiftChange({createdAt:at(10),updatedAt:at(12),completedAt:at(12),status:'VALIDADA'},at(9))).toEqual(['Resultado registrado']);
  });
});
