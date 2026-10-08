import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryType, Priority, SupervisionVisibility, Prisma } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import { searchOperationalRecords } from '@/server/services/global-search';
import { prisma as searchPrisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';

describe('identificadores humanos globales', () => {
  let receptionist: CurrentUser;
  let other: CurrentUser;
  let supervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Jaime Correlativo',
    });
    other = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción privada',
    });
    supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisión IDs',
    });
  });

  it('limita el filtro de entradas ocultas a los candidatos y conserva privacidad de orígenes',async()=>{
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    const unrelated=await prisma.operationalEntry.createManyAndReturn({data:Array.from({length:400},(_,index)=>({type:EntryType.NOVEDAD,title:`Historial ajeno ${index}`,description:'No coincide con el término',createdById:other.id}))});
    const hidden=await prisma.operationalEntry.create({data:{type:EntryType.NOVEDAD,title:'SEARCH_BOUND oculto',description:'No devolver',createdById:other.id}});
    await prisma.department.update({where:{id:area.id},data:{hiddenEntries:{connect:[...unrelated.map(row=>({id:row.id})),{id:hidden.id}]}}});
    const visible=await prisma.operationalEntry.create({data:{type:EntryType.NOVEDAD,title:'SEARCH_BOUND visible',description:'Devolver',createdById:other.id}});
    const visibleTask=await prisma.task.create({data:{title:'SEARCH_BOUND trabajo visible',entryId:visible.id,createdById:other.id}});
    const hiddenTask=await prisma.task.create({data:{title:'SEARCH_BOUND trabajo oculto',entryId:hidden.id,createdById:other.id}});
    const spy=vi.spyOn(searchPrisma,'$queryRaw');
    let searchSql:Prisma.Sql;
    try{
      const results=await searchOperationalRecords(receptionist,'SEARCH_BOUND');
      expect(results.map(row=>row.entityId).sort()).toEqual([visible.id,visibleTask.id].sort());
      expect(results.some(row=>row.entityId===hidden.id||row.entityId===hiddenTask.id)).toBe(false);
      searchSql=spy.mock.calls.map(call=>call[0]).find(query=>typeof query==='object'&&query!==null&&'text' in query&&typeof query.text==='string'&&query.text.includes('HumanOperationalRecord')) as Prisma.Sql;
      expect(searchSql).toBeDefined();
    }finally{spy.mockRestore();}
    const plan=await prisma.$queryRaw<Array<{'QUERY PLAN':Array<{Plan:Record<string,unknown>}>}>>(Prisma.sql`EXPLAIN (ANALYZE,FORMAT JSON) ${searchSql!}`);
    const nodes:Record<string,unknown>[]=[];const collect=(node:Record<string,unknown>)=>{nodes.push(node);for(const child of (node.Plans??[]) as Record<string,unknown>[])collect(child);};collect(plan[0]!['QUERY PLAN'][0]!.Plan);
    expect(nodes.find(node=>node['Subplan Name']==='CTE candidate_entries')?.['Actual Rows']).toBe(2);
    const hiddenSet=nodes.find(node=>node['Subplan Name']==='CTE hidden_entries');
    expect(hiddenSet).toBeDefined();expect(hiddenSet!['Actual Rows']).toBe(1);
    expect(await prisma.operationalEntry.count()).toBe(402);
  });

  it('usa un solo espacio numérico sin reemplazar los IDs técnicos', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Prueba de correlativo global',
      description: 'Registro para comprobar compatibilidad.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });
    const task = await createTask(receptionist, {
      title: 'Tarea con correlativo global',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
    });

    expect(entry.humanId).toBeGreaterThanOrEqual(1000);
    expect(task.humanId).toBeGreaterThan(entry.humanId);
    expect(task.humanId).not.toBe(entry.humanId);

    expect(typeof entry.id).toBe('string');
    expect(typeof task.id).toBe('string');
    expect(entry.id).not.toBe(String(entry.humanId));
    expect(task.id).not.toBe(String(task.humanId));

    // Compatibilidad: los correlativos históricos locales siguen existiendo
    // como datos técnicos, pero ya no son la referencia visible.
    expect(entry.seq).toBeGreaterThan(0);
    expect(task.seq).toBeGreaterThan(0);
  });

  it('no duplica números bajo creaciones concurrentes entre tablas distintas', async () => {
    const creations = Array.from({ length: 24 }, (_, index) =>
      index % 2 === 0
        ? prisma.operationalEntry.create({
            data: {
              type: EntryType.NOVEDAD,
              title: `Concurrente E${index}`,
              description: 'Prueba de concurrencia.',
              priority: Priority.MEDIA,
              createdById: receptionist.id,
            },
            select: { humanId: true },
          })
        : prisma.task.create({
            data: {
              title: `Concurrente T${index}`,
              priority: Priority.MEDIA,
              createdById: receptionist.id,
            },
            select: { humanId: true },
          }),
    );

    const rows = await Promise.all(creations);
    const ids = rows.map((row) => row.humanId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isInteger(id) && id >= 1000)).toBe(true);
  });

  it('resuelve #ID exacto primero y acepta búsqueda sin prefijo', async () => {
    const entry = await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Multa pendiente de revisión',
      description: 'Seguimiento operacional del caso.',
      priority: Priority.ALTA,
      tags: ['multa'],
      requiresFollowUp: false,
    });

    const byHash = await searchOperationalRecords(receptionist, `#${entry.humanId}`);
    const byNumber = await searchOperationalRecords(receptionist, String(entry.humanId));

    expect(byHash[0]).toMatchObject({
      humanId: entry.humanId,
      entityType: 'OperationalEntry',
      entityId: entry.id,
    });
    expect(byNumber[0]?.humanId).toBe(entry.humanId);
  });

  it('busca por habitación, huésped, responsable y términos combinados', async () => {
    const guarantee = await prisma.guarantee.create({
      data: {
        guestName: 'Sofía Prueba',
        roomNumber: '617',
        reference: 'Garantía efectivo',
        kind: 'EFECTIVO',
        state: 'VIGENTE',
        amount: '50000',
        currency: 'CLP',
        createdById: receptionist.id,
      },
    });

    const results = await searchOperationalRecords(
      receptionist,
      '617 Sofía garantía',
    );

    expect(results.some((row) => row.humanId === guarantee.humanId)).toBe(true);

    const byResponsible = await searchOperationalRecords(receptionist, 'Jaime Correlativo');
    expect(byResponsible.some((row) => row.humanId === guarantee.humanId)).toBe(true);
  });
  it('no expone seguimientos privados de otra persona en la búsqueda global', async () => {
    const followUp = await createFollowUp(supervisor, {
      action: 'Revisión reservada de Supervisión',
      ownerId: supervisor.id,
      visibility: SupervisionVisibility.PRIVADO,
    });

    const ownResults = await searchOperationalRecords(supervisor, String(followUp.humanId));
    const foreignResults = await searchOperationalRecords(other, String(followUp.humanId));

    expect(ownResults.some((row) => row.humanId === followUp.humanId)).toBe(true);
    expect(foreignResults.some((row) => row.humanId === followUp.humanId)).toBe(false);
  });

  it('no reutiliza un número consumido por una transacción revertida', async () => {
    let burned = 0;

    await expect(
      prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ value: number }>>`
          SELECT nextval('human_operational_id_seq'::regclass)::integer AS "value"
        `;
        burned = rows[0]!.value;
        throw new Error('rollback intencional');
      }),
    ).rejects.toThrow('rollback intencional');

    const rows = await prisma.$queryRaw<Array<{ value: number }>>`
      SELECT nextval('human_operational_id_seq'::regclass)::integer AS "value"
    `;

    expect(rows[0]!.value).toBeGreaterThan(burned);
  });

});
