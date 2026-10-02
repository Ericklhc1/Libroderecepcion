import { describe, expect, it, vi, beforeEach } from 'vitest';
const calls = vi.hoisted(() => ({ coordination: vi.fn(), task: vi.fn(),save:vi.fn(),simulate:vi.fn(),state:vi.fn() }));
vi.mock('@/server/actions/coordination', () => ({ coordinateWorkAction: calls.coordination }));
vi.mock('@/server/actions/operational-automation',()=>({saveAutomationAction:calls.save,simulateAutomationAction:calls.simulate,setAutomationStateAction:calls.state}));
vi.mock('@/server/actions/tasks', () => ({ changeTaskStatusAction: calls.task }));
import { coordinateWorkFormAction, changeTaskStatusFormAction } from '@/server/actions/operational-navigation';
beforeEach(() => { vi.clearAllMocks(); });
describe('Navegación posterior a operaciones nativas', () => {
  it('mantiene datos, permisos y resultado nativo; navega después del éxito conservando filtros', async () => {
    calls.coordination.mockResolvedValue({ ok: true, message: 'Asignado' });
    const form = new FormData(); form.set('returnTo', '/coordinacion?area=sintetica&mios=1'); form.set('ownerId', 'persona');
    expect((await coordinateWorkFormAction(null, form)).navigateTo).toBe('/coordinacion?area=sintetica&mios=1');
    expect(calls.coordination).toHaveBeenCalledExactlyOnceWith(null, form);
  });
  it('no navega ni oculta un rechazo nativo', async () => {
    const result = { ok: false, error: 'No autorizado', fieldErrors: { ownerId: ['Revisa responsable'] } };
    calls.coordination.mockResolvedValue(result);
    expect(await coordinateWorkFormAction(null, new FormData())).toEqual(result);

  });
  it('rechaza destinos externos, rutas distintas y escape con barra inversa', async () => {
    calls.task.mockResolvedValue({ ok: true, message: 'Resuelto' });
    for (const target of ['https://example.com', '//example.com', '/\\example.com', '/admin', '/tareas/../../admin']) {
      const form = new FormData(); form.set('returnTo', target);
      expect((await changeTaskStatusFormAction(null, form)).navigateTo).toBe('/tareas');
    }
    expect(calls.task).toHaveBeenCalledTimes(5);
  });
});

import { POST } from '@/app/api/operational-actions/[procedure]/route';
const context=(procedure='coordination')=>({params:Promise.resolve({procedure})});
const request=(body:unknown,origin='https://synthetic.invalid')=>new Request('https://synthetic.invalid/api/operational-actions/coordination',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
describe('Transporte JSON usa únicamente acciones nativas autorizadas',()=>{
  it('devuelve el resultado y destino local sin pedir una transición RSC',async()=>{
    calls.coordination.mockResolvedValue({ok:true,message:'Asignado'});
    const response=await POST(request({id:'registro',kind:'task',returnTo:'/coordinacion?mios=1'}),context());
    expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,message:'Asignado',navigateTo:'/coordinacion?mios=1'});
    expect(calls.coordination.mock.calls[0]![1].get('id')).toBe('registro');
  });
  it('rechaza origen ajeno y origen ausente antes de llamar a una acción',async()=>{
    for(const origin of ['https://foreign.invalid',''])expect((await POST(request({},origin),context())).status).toBe(403);
    expect(calls.coordination).not.toHaveBeenCalled();expect(calls.task).not.toHaveBeenCalled();
  });
  it('rechaza procedimientos y campos fuera de la lista explícita',async()=>{
    expect((await POST(request({}),context('arbitrary-action'))).status).toBe(404);
    expect((await POST(request({id:'registro',userId:'otra-identidad'}),context())).status).toBe(400);
    expect(calls.coordination).not.toHaveBeenCalled();expect(calls.task).not.toHaveBeenCalled();
  });
  it('detiene una carga excesiva antes de invocar servicios',async()=>{
    expect((await POST(request({nextAction:'x'.repeat(32769)}),context())).status).toBe(413);
    expect(calls.coordination).not.toHaveBeenCalled();
  });
  it('conserva el rechazo de permisos o estado decidido por la acción nativa',async()=>{
    calls.coordination.mockResolvedValue({ok:false,error:'No autorizado',fieldErrors:{ownerId:['No disponible']}});
    const response=await POST(request({id:'registro'}),context());
    expect(response.status).toBe(400);expect(await response.json()).toEqual({ok:false,error:'No autorizado',fieldErrors:{ownerId:['No disponible']}});
  });
});

describe('Formularios de políticas por el mismo servicio',()=>{
  it('conserva todos los días repetidos y navega sólo al guardar',async()=>{
    calls.save.mockResolvedValue({ok:true,message:'En pausa'});
    const response=await POST(request({name:'Sintética',weekdays:['1','3','5']}),context('automation-save'));
    expect(response.status).toBe(200);expect((await response.json()).navigateTo).toBe('/coordinacion/automatizaciones');
    expect(calls.save.mock.calls[0]![1].getAll('weekdays')).toEqual(['1','3','5']);
    calls.simulate.mockResolvedValue({ok:true,message:'Sin efectos'});
    expect(await (await POST(request({id:'policy'}),context('automation-simulate'))).json()).toEqual({ok:true,message:'Sin efectos'});
  });
  it('rechaza arrays fuera de días y campos de identidad',async()=>{
    for(const payload of [{ownerId:['1']},{userId:'otra-persona'}])expect((await POST(request(payload),context('automation-save'))).status).toBe(400);
    expect(calls.save).not.toHaveBeenCalled();
  });
});
