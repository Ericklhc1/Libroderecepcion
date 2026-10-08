import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:{id:'mucama',roleKey:'MUCAMA',permissions:['housekeeping.work'] as string[]},board:vi.fn(),sources:vi.fn()}));
vi.mock('@/server/auth/housekeeping',()=>({requireHousekeepingPageUser:async()=>mocks.user}));
vi.mock('@/server/services/housekeeping-work',()=>({getHkWorkday:mocks.board,getHkSources:mocks.sources}));
vi.mock('@/server/services/simple-novelties',()=>({simpleNoveltiesEnabled:async()=>false}));
vi.mock('next/link',()=>({default:'a'}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn(),push:vi.fn()})}));
import HousekeepingPage from '@/app/(app)/housekeeping/page';
const request=(id:string,assignedToId:string,status:string)=>({id,humanId:1001,version:1,workflowVersion:1,workKind:'LIMPIEZA',workDate:'2026-10-01',title:'Limpieza 512',description:'Limpiar y reponer',location:'512',priority:'MEDIA',requiresInspection:true,effortMinutes:35,status,assignedToId,assignedTo:{id:assignedToId,name:assignedToId},createdBy:{id:'recepcion',name:'Recepción'},room:{id:'room',number:'512',floor:5},sourceEntry:null,dueAt:null,acknowledgedAt:null,blockReason:null,resolution:null,inspectedBy:null,maintenanceEntry:null,events:[],isDemo:false});
function board(overrides:Record<string,unknown>={}){return{date:'2026-10-01',departmentId:'hk',requests:[],total:0,page:1,counts:{active:0,unassigned:0,review:0,blocked:0,overdue:0,completed:0,carryover:0},areas:[{id:'hk',name:'Housekeeping',key:'HOUSEKEEPING'}],rooms:[],roomBoard:[],zones:[],workload:[],routines:[],handovers:[],delegations:[],loans:[],suggestions:[],canAssign:false,canInspect:false,canPlan:false,canWork:true,canRequest:false,teamVisible:false,...overrides};}
async function html(){return renderToStaticMarkup(await HousekeepingPage({searchParams:Promise.resolve({})}));}
describe('Housekeeping: portada y acciones visibles por cargo',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.user.id='mucama';mocks.user.roleKey='MUCAMA';mocks.user.permissions=['housekeeping.work'];});
  it('la mucama identifica su trabajo y puede terminarlo, sin asignar ni aprobar',async()=>{mocks.board.mockResolvedValue(board({requests:[request('a','mucama','EN_GESTION')],total:1}));const text=await html();expect(text).toContain('Mi trabajo de hoy');expect(text).toContain('Marcar terminado');expect(text).not.toContain('Aprobar revisión');expect(text).not.toContain('Asignar / reasignar');expect(text).not.toContain('Equipo y carga del día');});
  it('el supervisor ve inspección ajena y no encuentra aprobación del propio trabajo',async()=>{mocks.user.id='supervisor';mocks.user.roleKey='SUPERVISOR_HOUSEKEEPING';mocks.user.permissions=['housekeeping.view','housekeeping.inspect','housekeeping.assign'];mocks.board.mockResolvedValue(board({canInspect:true,canAssign:true,teamVisible:true,requests:[request('a','supervisor','POR_REVISAR'),request('b','mucama','POR_REVISAR')],total:2}));const text=await html();expect(text).toContain('Coordinar y revisar');expect(text.match(/Aprobar revisión/g)).toHaveLength(1);expect(text).toContain('Equipo y carga del día');});
  it('HK-2 muestra habitaciones agrupadas y Resolver sólo para inspección ajena',async()=>{
    mocks.user.id='supervisor';mocks.user.permissions=['housekeeping.view','housekeeping.inspect','housekeeping.assign'];
    mocks.board.mockResolvedValue(board({canInspect:true,canAssign:true,teamVisible:true,requests:[request('a','mucama','POR_REVISAR')],total:1,roomBoard:[{id:'room',number:'512',floor:5,state:'PENDIENTE_INSPECCION',work:[{id:'a',humanId:1001,status:'POR_REVISAR'}]}]}));
    const text=await html();expect(text).toContain('Tablero de habitaciones');expect(text).toContain('Pendiente inspección');expect(text).toContain('Trabajo #1001');expect(text).toContain('aviso=1001');expect(text).toContain('Resolver');
    mocks.board.mockResolvedValue(board({canInspect:true,canAssign:true,teamVisible:true,requests:[request('a','supervisor','POR_REVISAR')],total:1}));
    expect(await html()).not.toContain('Resolver');
  });
  it('conserva área y fecha al buscar una novedad y no enlaza lectores ajenos al cargo',async()=>{
    mocks.user.permissions=['housekeeping.request'];mocks.sources.mockResolvedValue([{id:'source',humanId:400,title:'Solicitud propia',description:'Reponer',room:null}]);
    mocks.board.mockResolvedValue(board({date:'2026-10-02',departmentId:'publicas',canRequest:true}));
    const text=renderToStaticMarkup(await HousekeepingPage({searchParams:Promise.resolve({vista:'vincular',area:'publicas',fecha:'2026-10-02',q:'400'})}));
    expect(text).toContain('name="area" value="publicas"');expect(text).toContain('name="fecha" value="2026-10-02"');expect(text).toContain('Solicitud propia');expect(text).not.toContain('href="/libro/source"');
  });
  it('distingue un día sin organizar de un día con trabajo terminado',async()=>{mocks.board.mockResolvedValue(board());expect(await html()).toContain('Todavía no hay trabajo registrado');mocks.board.mockResolvedValue(board({counts:{active:0,unassigned:0,review:0,blocked:0,overdue:0,completed:3,carryover:0}}));expect(await html()).toContain('El trabajo registrado para este día está terminado');});
});
