import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import {subjectDistributionEnabled} from '@/server/services/subject-distribution-gate';
import {createEntry,getEntry,getSubjectEntry} from '@/server/services/entries';
import {distributeSubject,decideAreaAttention,listAreaAttentions} from '@/server/services/subject-distribution';
import {requestSubjectAttention} from '@/server/services/subject-attention';
import {createHkWork} from '@/server/services/housekeeping-work';
import {createHousekeepingRequest} from '@/server/services/housekeeping';
import {getCoordinationBoard} from '@/server/services/coordination';
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));
describe('Recuperación compatible: distribución apagada',()=>{
  beforeAll(seedCatalog);
  beforeEach(async()=>{vi.stubEnv('AROH_SUBJECT_AREA_DISTRIBUTION_ENABLED','');await resetOperationalData();});
  afterEach(async()=>{await resetOperationalData();await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "HousekeepingRequest_sourceEntryId_key" ON "HousekeepingRequest"("sourceEntryId")');vi.unstubAllEnvs();});
  async function fixture(){const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});const other=await prisma.department.findUniqueOrThrow({where:{key:'AREAS_PUBLICAS'}});const source=await createEntry(admin,{type:'NOVEDAD',title:'Asunto recovery',description:'Fuente sintética',priority:'ALTA',requiresFollowUp:false,tags:[]});return{admin,hk,other,source};}
  it('default-off bloquea ambas mutaciones nuevas incluso llamadas sin UI',async()=>{
    const f=await fixture();expect(subjectDistributionEnabled()).toBe(false);
    await expect(distributeSubject(f.admin,{entryId:f.source.id,revision:f.source.updatedAt.toISOString(),requestKey:randomUUID(),departmentIds:[f.hk.id]})).rejects.toThrow('no está habilitada');
    await expect(decideAreaAttention(f.admin,{sourceRevision:f.source.updatedAt.toISOString(),id:'unknown',version:1,action:'CONOCER'})).rejects.toThrow('no está habilitada');
    expect(await prisma.subjectAreaAttention.count()).toBe(0);
  });
  it('escritor anterior tras migración conserva unicidad global en base',async()=>{
    const f=await fixture();expect(f.source.resolvedAt).toBeNull();
    // Plain inserts deliberately emulate the old writer, which has no new feature check.
    await prisma.housekeepingRequest.create({data:{sourceEntryId:f.source.id,departmentId:f.hk.id,requestKey:randomUUID(),createdById:f.admin.id}});
    await expect(prisma.housekeepingRequest.create({data:{sourceEntryId:f.source.id,departmentId:f.other.id,requestKey:randomUUID(),createdById:f.admin.id}})).rejects.toMatchObject({code:'P2002'});
    expect((await getEntry(f.source.id)).housekeepingRequests).toHaveLength(1);expect((await getEntry(f.source.id)).resolvedAt).toBeNull();
    expect((await getCoordinationBoard(f.admin)).rows.some(r=>r.id===f.source.id)).toBe(true);
  });
  it('rutas nativas y heredadas no habilitan multiplicidad al quitar sólo índice en fixture',async()=>{
    const f=await fixture();await prisma.$executeRawUnsafe('DROP INDEX "HousekeepingRequest_sourceEntryId_key"');
    const input={entryId:f.source.id,revision:f.source.updatedAt.toISOString(),requestKey:randomUUID(),departmentId:f.hk.id,location:'Zona recovery'};
    await requestSubjectAttention(f.admin,input);
    await expect(requestSubjectAttention(f.admin,{...input,requestKey:randomUUID(),departmentId:f.other.id})).rejects.toThrow('otra área');
    await expect(createHkWork(f.admin,{requestKey:randomUUID(),sourceEntryId:f.source.id,departmentId:f.other.id,title:'Duplicado',description:'No crear',location:'Zona',workDate:'2026-10-05',workKind:'ATENCION',priority:'MEDIA',effortMinutes:10})).rejects.toThrow('no está habilitada');
    await expect(createHousekeepingRequest(f.admin,{requestKey:randomUUID(),sourceEntryId:f.source.id,departmentId:f.other.id,priority:'MEDIA'})).rejects.toThrow('no está habilitada');
    expect(await prisma.housekeepingRequest.count({where:{sourceEntryId:f.source.id}})).toBe(1);
  });
  it('apagado mantiene lectura de todas las intervenciones y decisiones con privacidad',async()=>{
    const f=await fixture();await prisma.$executeRawUnsafe('DROP INDEX "HousekeepingRequest_sourceEntryId_key"');
    for(const [i,area] of [f.hk,f.other].entries()){
      const work=await prisma.housekeepingRequest.create({data:{sourceEntryId:f.source.id,departmentId:area.id,requestKey:randomUUID(),createdById:f.admin.id,workflowVersion:1,workDate:'2026-10-05',workKind:'ATENCION',location:'Zona',status:'RESUELTO',resolution:`Resultado ${i+1}`,resolvedAt:new Date()}});
      await prisma.subjectAreaAttention.create({data:{requestKey:randomUUID(),entryId:f.source.id,departmentId:area.id,createdById:f.admin.id,status:'ASIGNADA',housekeepingId:work.id}});
    }
    const entry=await getSubjectEntry(f.admin,f.source.id);expect(entry.housekeepingRequests.map(r=>r.resolution).sort()).toEqual(['Resultado 1','Resultado 2']);
    expect((await listAreaAttentions(f.admin,{entryId:f.source.id})).rows).toHaveLength(2);
    expect((await getCoordinationBoard(f.admin)).rows.filter(r=>r.id===f.source.id)).toHaveLength(1);
    const outsider=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});expect((await listAreaAttentions(outsider)).rows).toHaveLength(0);
    const row=await prisma.subjectAreaAttention.findFirstOrThrow();await expect(decideAreaAttention(f.admin,{sourceRevision:f.source.updatedAt.toISOString(),id:row.id,version:row.version,action:'REABRIR',note:'No ejecutar con gate apagado'})).rejects.toThrow('no está habilitada');
  });
  it('UI conserva lectores y no ofrece mutaciones nuevas con control apagado',()=>{
    const source=readFileSync('src/app/(app)/libro/[id]/page.tsx','utf8');const inbox=readFileSync('src/app/(app)/coordinacion/areas/page.tsx','utf8');
    expect(source).toContain('distributionEnabled?<SubjectDistributionDialog');expect(source).toContain('entry.housekeepingRequests.map');expect(inbox).toContain("enabled&&!['RESUELTO','CERRADO']");expect(inbox).toContain('Páginas de bandeja de áreas');expect(inbox).toContain('sourceRevision={row.entry.updatedAt.toISOString()}');
    const form=readFileSync('src/components/operational/subject-distribution-dialog.tsx','utf8');expect(form).toContain('El asunto original sigue guardado');expect(form).toContain('!a.people.length');
  });
});
