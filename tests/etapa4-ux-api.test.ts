import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),persist:vi.fn()}));
vi.mock('@/server/auth/current-user',()=>({getCurrentUser:mocks.user}));
vi.mock('@/server/observability/operational',()=>({persistOperationalEvent:mocks.persist}));
import {POST} from '@/app/api/ux-events/route';
const event={intentId:'e6d10c20-250a-4e85-8bad-ae1a080fb2a7',event:'ACTION',route:'asunto',selectedAction:'ASSIGN'};
const request=(value:unknown,origin='https://synthetic.invalid')=>new Request('https://synthetic.invalid/api/ux-events',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({id:'actual',roleKey:'RECEPCION',departmentId:'area-actual',mustChangePassword:false});mocks.persist.mockResolvedValue(true);});
describe('Telemetría UX autenticada sin datos de formularios',()=>{
  it('deriva identidad, rol y área de la sesión y marca observación cliente',async()=>{
    expect((await POST(request(event))).status).toBe(204);
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({userId:'actual',source:'CLIENT_UI',status:'STARTED',metadata:expect.objectContaining({role:'RECEPCION',area:'area-actual',selectedAction:'ASSIGN'})}));
  });
  it('rechaza orígenes ajenos o ausentes antes de consultar identidad',async()=>{
    for(const origin of ['https://foreign.invalid',''])expect((await POST(request(event,origin))).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();expect(mocks.persist).not.toHaveBeenCalled();
  });
  it('requiere sesión habilitada y rechaza identidad o contenido suministrados',async()=>{
    mocks.user.mockResolvedValueOnce(null);expect((await POST(request(event))).status).toBe(401);
    mocks.user.mockResolvedValueOnce({mustChangePassword:true});expect((await POST(request(event))).status).toBe(401);
    for(const extra of [{userId:'otro'},{description:'privado'},{role:'ADMIN'}])expect((await POST(request({...event,...extra}))).status).toBe(400);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it('limita bytes de entrada y no confunde pendiente con éxito',async()=>{
    expect((await POST(request({...event,description:'x'.repeat(2049)}))).status).toBe(413);
    expect((await POST(request({...event,event:'RESULT',result:'PENDING'}))).status).toBe(400);
    expect((await POST(request({...event,event:'EXIT',result:'PENDING'}))).status).toBe(204);
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({eventType:'UX_EXIT',status:'STARTED'}));
  });
  it('declara falta de persistencia sin aparentar medición exitosa',async()=>{
    mocks.persist.mockResolvedValue(false);expect((await POST(request(event))).status).toBe(503);
  });
});
