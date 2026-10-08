import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CurrentUser } from '@/server/auth/current-user';
import { createUser, seedCatalog, resetOperationalData, ROLE_KEYS, prisma } from './helpers';
import { createEntry, updateEntryVisibility } from '@/server/services/entries';
const auth=vi.hoisted(()=>({user:null as CurrentUser|null}));
vi.mock('@/server/auth/guard',()=>({requirePageUser:async()=>auth.user}));
vi.mock('next/link',()=>({default:'a'}));
import IncidentsPage from '@/app/(app)/incidencias/page';

describe('Incidencias respeta la visibilidad en filas y contadores',()=>{
  beforeAll(seedCatalog);
  beforeEach(resetOperationalData);
  it('una incidencia oculta no aparece ni aumenta abiertas o gravedad, y su autor la conserva',async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const reader=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const visible=await createEntry(supervisor,{type:'INCIDENCIA',title:'INCIDENTE_VISIBLE',description:'Incidencia de prueba visible.',severity:'CRITICA',priority:'ALTA',tags:[],requiresFollowUp:false});
    const hidden=await createEntry(supervisor,{type:'INCIDENCIA',title:'INCIDENTE_OCULTO',description:'Incidencia de prueba oculta.',severity:'CRITICA',priority:'ALTA',tags:[],requiresFollowUp:false});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    await updateEntryVisibility(supervisor,{id:hidden.id,revision:hidden.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    auth.user=reader;
    const html=renderToStaticMarkup(await IncidentsPage({searchParams:Promise.resolve({})}));
    expect(html).toContain(visible.title);expect(html).not.toContain(hidden.title);
    // Both critical and open counters must be 1, rather than revealing the hidden item.
    expect(html).toMatch(/Abiertas[\s\S]*?>1<\/p>/);expect(html).toMatch(/Gravedad Crítica[\s\S]*?>1<\/p>/);
    auth.user=supervisor;
    const own=renderToStaticMarkup(await IncidentsPage({searchParams:Promise.resolve({})}));
    expect(own).toContain(hidden.title);expect(own).toMatch(/Abiertas[\s\S]*?>2<\/p>/);
  });
});
