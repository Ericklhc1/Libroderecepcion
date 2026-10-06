import {beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import {operationalLanding} from '@/domain/operational-entry';
import {getCoordinationBoard} from '@/server/services/coordination';
import {getSupervisionData} from '@/server/services/supervision';
import {createHkWork,getHkWorkday} from '@/server/services/housekeeping-work';
import {hotelDateKey} from '@/domain/time';

describe('AROH Simple · trabajo relevante por rol y excepción',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  it('elige la entrada existente del rol sin conceder permisos y conserva el acceso administrativo',async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const manager=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    expect(operationalLanding(admin,'MANTENIMIENTO')).toBeNull();
    expect(operationalLanding(manager)).toBe('/gerencia');
    expect(operationalLanding(supervisor)).toContain('/supervision');
    expect(operationalLanding(supervisor,'MANTENIMIENTO')).toBe('/coordinacion?vista=unreceived');
    expect(operationalLanding(maid)).toBe('/housekeeping');
    expect(operationalLanding({...manager,permissions:[]})).toBeNull();
  });
  it('buscar y filtrar abre el trabajo vinculado real sin duplicar la novedad sin responsable',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const worker=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}});
    const room=await prisma.room.findUniqueOrThrow({where:{number:'512'}});
    const source=await prisma.operationalEntry.create({data:{type:'NOVEDAD',title:'Revisar climatización',description:'Contexto de 512',createdById:admin.id,roomId:room.id}});
    const due=new Date(Date.now()+3600000);
    const task=await prisma.task.create({data:{title:"Reponer pieza",createdById:admin.id,entryId:source.id,roomId:room.id,departmentId:area.id,assigneeId:worker.id,status:'BLOQUEADA',blockedReason:'Falta repuesto',dueAt:due}});
    const result=await getCoordinationBoard(admin,{q:'512',departmentId:area.id,state:'bloqueado',ownerId:worker.id,date:hotelDateKey(due)});
    expect(result.rows.map(r=>r.id)).toEqual([task.id]);expect(result.total).toBe(1);
    expect(result.rows[0]?.source).toEqual({humanId:source.humanId,href:`/libro/${source.id}`});
    expect((await getCoordinationBoard(admin,{view:'unassigned'})).rows.some(r=>r.id===source.id)).toBe(false);
    expect((await getCoordinationBoard(admin,{q:'Sin coincidencia'})).total).toBe(0);
    const assignedOnly={...worker,permissions:[]};
    const searched=await getCoordinationBoard(assignedOnly,{q:source.title});
    expect(searched.rows.map(row=>row.id)).toEqual([task.id]);
    expect(searched.rows[0]?.source).toEqual({humanId:source.humanId,href:`/libro/${source.id}`});
  });
  it('agrupa varios trabajos y Housekeeping del mismo asunto antes de contar y paginar',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const room=await prisma.room.findUniqueOrThrow({where:{number:'512'}});
    const roots:Array<{id:string;humanId:number}>=[];
    for(let i=0;i<27;i++){
      const source=await prisma.operationalEntry.create({data:{type:'NOVEDAD',title:`Asunto agrupado ${i}`,description:'Contexto de la atención',createdById:admin.id,roomId:room.id}});roots.push(source);
      await prisma.task.createMany({data:[0,1].map(j=>({title:`Trabajo ${i}/${j}`,createdById:admin.id,entryId:source.id,departmentId:area.id,assigneeId:admin.id}))});
    }
    const hk=await createHkWork(admin,{requestKey:randomUUID(),sourceEntryId:roots[0]!.id,title:'Atención vinculada',description:'Contexto conservado',roomId:room.id,departmentId:area.id,workDate:hotelDateKey(new Date()),workKind:'ATENCION',effortMinutes:15,priority:'MEDIA'});
    const first=await getCoordinationBoard(admin),second=await getCoordinationBoard(admin,{page:2});
    expect(first.total).toBe(27);expect(first.rows).toHaveLength(25);expect(second.rows).toHaveLength(2);
    const all=[...first.rows,...second.rows];expect(new Set(all.map(row=>row.source?.humanId)).size).toBe(27);
    expect(first.byArea.reduce((total,area)=>total+area.total,0)).toBe(27);
    const group=all.find(row=>row.source?.humanId===roots[0]!.humanId)!;
    expect(group.kind==='housekeeping'||group.children.some(child=>child.href.includes(`aviso=${hk.humanId}`))).toBe(true);
    expect(group.children.some(child=>child.href.startsWith('/tareas/'))).toBe(true);
  });
  it('cuenta un asunto en cada área activa y elige trabajo accionable como representante',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const maintenance=await prisma.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}});
    const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const room=await prisma.room.findUniqueOrThrow({where:{number:'512'}});
    const source=await prisma.operationalEntry.create({data:{type:'NOVEDAD',title:'Asunto multiárea',description:'Mismo origen para dos áreas',createdById:admin.id,roomId:room.id}});
    const task=await prisma.task.create({data:{title:'Revisar equipo',createdById:admin.id,entryId:source.id,departmentId:maintenance.id,assigneeId:admin.id,dueAt:new Date(Date.now()+3600000)}});
    await prisma.followUp.create({data:{action:'Confirmar continuidad',createdById:admin.id,ownerId:admin.id,entryId:source.id,scheduledAt:new Date(Date.now()-3600000),visibility:'OPERATIVO'}});
    const work=await createHkWork(admin,{requestKey:randomUUID(),sourceEntryId:source.id,title:'Reponer insumo',description:'Atención del mismo asunto',roomId:room.id,departmentId:hk.id,workDate:hotelDateKey(new Date()),workKind:'ATENCION',effortMinutes:15,priority:'MEDIA'});
    const board=await getCoordinationBoard(admin);
    expect(board.total).toBe(1);
    expect(board.rows[0]?.kind).toBe('task');
    expect(board.rows[0]?.id).toBe(task.id);
    expect(board.rows[0]?.children.some(child=>child.href.includes(`aviso=${work.humanId}`))).toBe(true);
    expect(board.byArea.find(area=>area.departmentId===maintenance.id)?.total).toBe(1);
    expect(board.byArea.find(area=>area.departmentId===hk.id)?.total).toBe(1);
  });
  it('la excepción y los conteos no revelan trabajo privado aunque el tercero conserve su asignación',async()=>{
    const reader=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const reserved=await prisma.followUp.create({data:{action:'Continuidad privada',createdById:owner.id,ownerId:owner.id,visibility:'PRIVADO',scheduledAt:new Date(Date.now()-3600000)}});
    await prisma.task.create({data:{title:'Trabajo privado',createdById:owner.id,assigneeId:reader.id,followUpId:reserved.id,status:'BLOQUEADA',dueAt:new Date(Date.now()-3600000)}});
    expect((await getCoordinationBoard(reader,{mine:true})).total).toBe(0);
    expect(JSON.stringify(await getSupervisionData(reader))).not.toContain('privad');
    expect(JSON.stringify(await getSupervisionData(owner))).toContain('Trabajo privado');
  });
  it('Housekeeping busca contexto heredado dentro del alcance propio y mantiene continuidad',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    const other=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    await prisma.user.updateMany({where:{id:{in:[maid.id,other.id]}},data:{departmentId:area.id}});
    const room=await prisma.room.findUniqueOrThrow({where:{number:'512'}});
    const work=await createHkWork(admin,{requestKey:randomUUID(),title:'Reponer toallas',description:'Necesidad de recepción',roomId:room.id,departmentId:area.id,assignedToId:maid.id,workDate:hotelDateKey(new Date()),workKind:'REPOSICION',effortMinutes:15,priority:'MEDIA'});
    expect((await getHkWorkday(maid,{q:'512'})).requests.map(r=>r.id)).toEqual([work.id]);
    expect((await getHkWorkday(other,{q:'512'})).total).toBe(0);
    expect((await getHkWorkday(maid,{q:'Sin coincidencia'})).total).toBe(0);
  });
});
