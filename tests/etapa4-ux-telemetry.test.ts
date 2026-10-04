import { describe,expect,it } from 'vitest';
import { uxAction,uxRoute } from '@/domain/ux-telemetry';
import { uxEventSchema } from '@/domain/ux-telemetry-schema';
import { persistOperationalEvent } from '@/server/observability/operational';

describe('AROH Simple · telemetría sin contenido operativo',()=>{
  it('normaliza fuentes y excluye rutas técnicas y consultas con contenido',()=>{
    expect(uxRoute('/libro/cmun4uuj60001i6042xth57hy')).toEqual({route:'asunto',entityType:'OperationalEntry',entityId:'cmun4uuj60001i6042xth57hy'});
    expect(uxRoute('/admin/seguridad')).toBeNull();expect(uxRoute('/libro?q=nombre-privado')).toBeNull();
    expect(uxAction('Texto de una descripción privada')).toBe('OTHER');
    expect(uxAction('Solicitar otra atención')).toBe('REQUEST_ATTENTION');
    expect(uxAction('Solicitar atención')).toBe('REQUEST_ATTENTION');
  });
  it('rechaza contenido de formularios, identidad proporcionada por cliente y duración inválida',()=>{
    const base={intentId:'e6d10c20-250a-4e85-8bad-ae1a080fb2a7',event:'ROUTE',route:'asunto'};
    expect(uxEventSchema.safeParse(base).success).toBe(true);
    for(const extra of [{description:'privado'},{userId:'otro'},{role:'ADMIN'},{duration:-1},{selectedAction:'texto libre'},{entityId:'clave/sensible'}])expect(uxEventSchema.safeParse({...base,...extra}).success).toBe(false);
  });
  it('reutiliza observabilidad y conserva sólo acciones conocidas, sin errores que bloqueen operación',async()=>{
    let written:unknown;
    expect(await persistOperationalEvent({eventType:'UX_ROUTE',status:'STARTED',source:'CLIENT_UI',metadata:{route:'asunto',visibleActions:['ASSIGN','REMIND','texto privado'],description:'no guardar'}},async data=>{written=data;})).toBe(true);
    expect(written).toMatchObject({eventType:'UX_ROUTE',metadata:{route:'asunto',visibleActions:['ASSIGN','REMIND']}});
    expect(JSON.stringify(written)).not.toContain('privado');
    expect(await persistOperationalEvent({eventType:'UX_RESULT',status:'FAILED'},async()=>{throw new Error('offline');})).toBe(false);
  });
});
