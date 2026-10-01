import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ROLE_KEYS, createUser, prisma, resetOperationalData, resetRoomsAndKeys, seedCatalog } from './helpers';
import { createAreaKey, lendStaffKeys, listStaffLoans, listSupervisorKeys, returnStaffKey, saveKeyArea, saveSupervisorKey, type StaffLoanInput } from '@/server/services/key-staff';
import { getPhysicalKeyInventory, markPhysicalKeyIncident, savePhysicalKeyInventoryCount } from '@/server/services/key-inventory';
import { getKeyInventory, giveExtraCopy, listAvailableKeys, reconcilePrincipalKeys, setKeyIncidentStatus } from '@/server/services/keys';
import { areaCountSnapshots, staffCustodySnapshots } from '@/domain/key-custody';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';
import { executeFrontiPageContextTool } from '@/server/ai/fronti-v2/page-context-tool';
import { searchOperationalRecords } from '@/server/services/global-search';

describe('áreas, custodia de personal y reserva privada de llaves', () => {
  beforeEach(async () => { await resetOperationalData(); await resetRoomsAndKeys(); await seedCatalog(); });
  async function setup() {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const department = await prisma.department.findFirstOrThrow({ where: { active: true } });
    const rooms = await prisma.room.findMany({ where: { number: { in:['401','402'] } }, orderBy:{number:'asc'},include:{keys:{where:{type:'PRINCIPAL'}}} });
    const input: StaffLoanInput = { requestKey:randomUUID(),departmentId:department.id,authorizedById:supervisor.id,items:rooms.map(r => ({keyId:r.keys[0]!.id,source:'public',destinationId:r.id,destinationKind:'ROOM'})) };
    return {supervisor,receptionist,department,rooms,input};
  }
  it('entrega varias habitaciones sin colaborador, congela autorización y devuelve parcialmente', async () => {
    const {supervisor,receptionist,department,input} = await setup();
    const loans = await Promise.all([lendStaffKeys(receptionist,input),lendStaffKeys(receptionist,input)]);
    expect(loans[0]!.id).toBe(loans[1]!.id);
    const loan = (await listStaffLoans(receptionist))[0]!;
    expect(loan.departmentName).toBe(department.name); expect(loan.authorizedByName).toBe(supervisor.name); expect(loan.createdById).toBe(receptionist.id); expect(loan.collaboratorId).toBeNull(); expect(loan.items).toHaveLength(2);
    expect(await prisma.roomKey.count({where:{status:'ENTREGADA_PERSONAL'}})).toBe(2);
    await expect(lendStaffKeys(receptionist,{...input,notes:'otro contenido'})).rejects.toThrow('referencia');
    await prisma.user.update({where:{id:supervisor.id},data:{name:'Nombre actualizado'}});
    expect((await listStaffLoans(receptionist))[0]!.authorizedByName).toBe(supervisor.name);
    await returnStaffKey(receptionist,loan.items[0]!.id,'Llave física recibida');
    await returnStaffKey(receptionist,loan.items[0]!.id,'Reintento de recepción');
    expect((await listStaffLoans(receptionist))[0]!.items.filter(i=>!i.returnedAt)).toHaveLength(1);
    expect(await prisma.keyMovement.count({where:{keyId:loan.items[0]!.roomKeyId!,action:'DEVUELTA'}})).toBe(1);
  });
  it('registra un lote completo de 89 llaves sin entregas parciales', async () => {
    const {receptionist,input} = await setup();
    const keys = await prisma.roomKey.findMany({where:{type:'PRINCIPAL',roomId:{not:null}},select:{id:true,roomId:true}});
    const batch = {...input,items:keys.map(k=>({keyId:k.id,source:'public' as const,destinationId:k.roomId!,destinationKind:'ROOM' as const}))};
    await lendStaffKeys(receptionist,batch);
    expect(await prisma.keyStaffLoanItem.count({where:{returnedAt:null}})).toBe(89);
    expect(await prisma.roomKey.count({where:{status:'ENTREGADA_PERSONAL'}})).toBe(89);
    expect(await prisma.keyMovement.count({where:{toStatus:'ENTREGADA_PERSONAL'}})).toBe(89);
  });
  it('exige área, autorizador habilitado, destino correcto y colaborador de esa área', async () => {
    const {supervisor,receptionist,department,input} = await setup();
    await expect(lendStaffKeys(receptionist,{...input,departmentId:''})).rejects.toThrow('área');
    await expect(lendStaffKeys(receptionist,{...input,authorizedById:receptionist.id})).rejects.toThrow('Supervisor');
    await expect(lendStaffKeys(receptionist,{...input,collaboratorId:receptionist.id})).rejects.toThrow('pertenecer');
    await expect(lendStaffKeys(receptionist,{...input,items:[{...input.items[0]!,destinationId:input.items[1]!.destinationId}]})).rejects.toThrow('destino');
    const higher = await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    await prisma.user.update({where:{id:receptionist.id},data:{departmentId:department.id}});
    const loan = await lendStaffKeys(receptionist,{...input,authorizedById:higher.id,collaboratorId:receptionist.id});
    expect(loan.collaboratorName).toBe(receptionist.name);
    expect(loan.authorizedById).not.toBe(supervisor.id);
  });
  it('acepta pertenencia adicional del colaborador sin cambiar su área principal', async () => {
    const {receptionist,department,input} = await setup();
    const person = await prisma.scheduleCollaborator.create({data:{userId:receptionist.id,employeeCode:'TEST-LLAVE',name:receptionist.name,functionName:'Personal',memberships:{create:{departmentId:department.id}}}});
    expect(person.userId).toBe(receptionist.id);
    expect((await lendStaffKeys(receptionist,{...input,collaboratorId:receptionist.id})).collaboratorId).toBe(receptionist.id);
  });
  it('solo una entrega concurrente puede ocupar cada llave', async () => {
    const {receptionist,input} = await setup();
    const results = await Promise.allSettled([lendStaffKeys(receptionist,input),lendStaffKeys(receptionist,{...input,requestKey:randomUUID()})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(await prisma.keyStaffLoan.count()).toBe(1);
    expect(await prisma.keyStaffLoanItem.count({where:{returnedAt:null}})).toBe(2);
  });
  it('no altera custodias al reconciliar PMS ni permite incidentes por el flujo de huéspedes', async () => {
    const {receptionist,rooms,input} = await setup();
    await lendStaffKeys(receptionist,input);
    await prisma.roomStay.create({data:{roomId:rooms[0]!.id,reservationId:'STAFF-PMS',guestNames:['Huésped'],sourceReport:'IN_HOUSE',businessDate:new Date(),status:'IN_HOUSE',stage:'CONFIRMADO'}});
    await prisma.$transaction(tx=>reconcilePrincipalKeys(tx,receptionist,{}));
    expect((await prisma.roomKey.findUniqueOrThrow({where:{id:input.items[0]!.keyId}})).status).toBe('ENTREGADA_PERSONAL');
    await expect(setKeyIncidentStatus(receptionist,{keyId:input.items[0]!.keyId,status:'EXTRAVIADA',reason:'Prueba'})).rejects.toThrow('personal');
    await expect(markPhysicalKeyIncident(receptionist,{keyId:input.items[0]!.keyId,status:'EXTRAVIADA',reason:'Prueba'})).rejects.toThrow('personal');
  });
  it('crea un destino área sin ampliar 89 habitaciones y no presta esas copias a huéspedes', async () => {
    const {supervisor,receptionist,input,rooms} = await setup();
    const area = await saveKeyArea(supervisor,{name:'Bodega de ropa',active:true});
    const key = await createAreaKey(supervisor,{areaId:area.id,code:'BOD-01'});
    expect(await prisma.room.count()).toBe(89);
    expect((await getPhysicalKeyInventory({floor:4})).summary.expected).toBe(29);
    expect((await listAvailableKeys()).some(k=>k.value===key.id)).toBe(false);
    await expect(giveExtraCopy(receptionist,{roomId:rooms[0]!.id,keyId:key.id})).rejects.toThrow();
    await lendStaffKeys(receptionist,{...input,items:[{keyId:key.id,source:'public',destinationId:area.id,destinationKind:'AREA'}]});
    await expect(saveKeyArea(supervisor,{id:area.id,name:area.name,active:false})).rejects.toThrow('Recibe');
  });
  it('presta una copia libre y la devuelve a recepción sin cambiar su destino original', async () => {
    const {receptionist,input} = await setup();
    const copy = await prisma.roomKey.findFirstOrThrow({where:{roomId:null,areaId:null,type:'COPIA',status:'DISPONIBLE'}});
    await lendStaffKeys(receptionist,{...input,items:[{...input.items[0]!,keyId:copy.id}]});
    const loan = (await listStaffLoans(receptionist))[0]!;
    expect(loan.items[0]!.destinationId).toBe(input.items[0]!.destinationId);
    await returnStaffKey(receptionist,loan.items[0]!.id,'Copia recibida en recepción');
    const returned = await prisma.roomKey.findUniqueOrThrow({where:{id:copy.id}});
    expect(returned.status).toBe('DISPONIBLE'); expect(returned.roomId).toBeNull(); expect(returned.areaId).toBeNull();
  });
  it('el stock y su edición son exclusivos del supervisor propietario, incluso frente al administrador', async () => {
    const {supervisor,receptionist} = await setup();
    const other = await createUser({roleKey:ROLE_KEYS.SUPERVISOR}); const admin = await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const key = await saveSupervisorKey(supervisor,{code:'PRIV-1',destination:'Reserva de supervisión'});
    expect(await listSupervisorKeys(other)).toEqual([]);
    await expect(listSupervisorKeys(admin)).rejects.toThrow('exclusivamente');
    await expect(listSupervisorKeys(receptionist)).rejects.toThrow('exclusivamente');
    await expect(saveSupervisorKey(other,{id:key.id,version:key.version,code:key.code,destination:'Intento'})).rejects.toThrow('pertenece');
    const changed = await saveSupervisorKey(supervisor,{id:key.id,version:key.version,code:key.code,destination:'Nueva ubicación'});
    await expect(saveSupervisorKey(supervisor,{id:key.id,version:key.version,code:key.code,destination:'Dato viejo'})).rejects.toThrow('cambió');
    expect((await listSupervisorKeys(supervisor))[0]!.destination).toBe(changed.destination);
    expect((await getKeyInventory()).keys.some(k=>k.code===key.code)).toBe(false);
    expect(await prisma.auditLog.count({where:{summary:{contains:key.code}}})).toBe(0);
  });
  it('puede entregar desde su stock privado sin exponer la reserva ni permitir recepción ajena', async () => {
    const {supervisor,receptionist,input} = await setup();
    const key = await saveSupervisorKey(supervisor,{code:'PRIV-ENT',destination:'Maestra'});
    const unused = await saveSupervisorKey(supervisor,{code:'PRIV-SECRETA',destination:'Reserva'});
    const privateInput = {...input,items:[{...input.items[0]!,keyId:key.id,source:'private' as const}]};
    await expect(lendStaffKeys(receptionist,privateInput)).rejects.toThrow('exclusivamente');
    await lendStaffKeys(supervisor,privateInput);
    const loan = (await listStaffLoans(receptionist))[0]!; expect(loan.items[0]!.keyCode).toBe(key.code);
    expect(JSON.stringify(loan)).not.toContain(unused.code);
    const fronti = await executeFrontiPageContextTool(receptionist,resolveFrontiPageContext({pathname:'/llaves/personal'}));
    expect(JSON.stringify(fronti)).toContain(key.code); expect(JSON.stringify(fronti)).not.toContain(unused.code);
    const receipt = await executeFrontiPageContextTool(receptionist,resolveFrontiPageContext({pathname:`/llaves/personal/${loan.id}`}));
    expect(JSON.stringify(receipt)).toContain(key.code); expect(JSON.stringify(receipt)).not.toContain(unused.code);
    await expect(executeFrontiPageContextTool({...receptionist,permissions:[]},resolveFrontiPageContext({pathname:'/llaves/personal'}))).rejects.toThrow('permiso');
    await expect(returnStaffKey(receptionist,loan.items[0]!.id,'Recibida')).rejects.toThrow('propietario');
    await expect(saveSupervisorKey(supervisor,{id:key.id,version:1,code:key.code,destination:'Editar prestada'})).rejects.toThrow('Recibe');
    await returnStaffKey(supervisor,loan.items[0]!.id,'Recibida en mi stock');
    expect((await listSupervisorKeys(supervisor)).find(k=>k.id===key.id)?.status).toBe('DISPONIBLE');
  });
  it('guarda custodias y áreas como evidencia inmutable del conteo y exige revisar todas las áreas', async () => {
    const {supervisor,receptionist,input} = await setup();
    const area = await saveKeyArea(supervisor,{name:'Oficina',active:true});
    await createAreaKey(supervisor,{areaId:area.id,code:'OF-1'});
    await lendStaffKeys(receptionist,input);
    const floors = await Promise.all(([4,5,6] as const).map(floor=>getPhysicalKeyInventory({floor})));
    const items = floors.flatMap(f=>f.rooms).map(r=>({roomId:r.roomId,found:1,outOfService:0}));
    await expect(savePhysicalKeyInventoryCount(receptionist,{floor:'todos',items})).rejects.toThrow('áreas');
    const countInput = {floor:'todos' as const,requestKey:randomUUID(),items,areas:[{areaId:area.id,found:1,accountedElsewhere:0,outOfService:0}]};
    const count = await savePhysicalKeyInventoryCount(receptionist,countInput);
    expect(staffCustodySnapshots(count.staffCustodySnapshot)[0]!.items).toHaveLength(2);
    expect(areaCountSnapshots(count.areasSnapshot)[0]!.name).toBe('Oficina');
    await prisma.keyArea.update({where:{id:area.id},data:{name:'Nombre nuevo'}});
    const loan = (await listStaffLoans(receptionist))[0]!;
    await returnStaffKey(receptionist,loan.items[0]!.id,'Llave recibida');
    const historic = await prisma.keyInventoryCount.findUniqueOrThrow({where:{id:count.id}});
    expect(historic.areasSnapshot).toEqual(count.areasSnapshot); expect(historic.staffCustodySnapshot).toEqual(count.staffCustodySnapshot);
    expect((await savePhysicalKeyInventoryCount(receptionist,countInput)).id).toBe(count.id);
    await expect(savePhysicalKeyInventoryCount(receptionist,{...countInput,areas:[{...countInput.areas[0]!,found:2}]})).rejects.toThrow('otro contenido');
    const search = await searchOperationalRecords(receptionist,`#${loan.humanId}`);
    expect(search.some(r=>r.entityType==='KeyStaffLoan' && r.entityId===loan.id)).toBe(true);
  });
});
