import {beforeEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReceptionOperationGate} from '@/components/operational/reception-operation-gate';
const location=vi.hoisted(()=>({pathname:'/libro'}));
vi.mock('next/navigation',()=>({usePathname:()=>location.pathname}));
vi.mock('next/link',()=>({default:'a'}));
describe('acceso del saliente al libro simple',()=>{
  beforeEach(()=>{location.pathname='/libro';});
  it('apagado mantiene el bloqueo de Recepción sin turno',()=>{expect(renderToStaticMarkup(<ReceptionOperationGate mode="NO_SHIFT"/>)).toContain('Operación bloqueada');});
  it('encendido deja resolver desde la lista y detalle incluso mientras entrega o recibe',()=>{
    for(const mode of ['NO_SHIFT','CLOSING','RECEIVING','HANDOVER_PENDING'] as const)for(const path of ['/libro','/libro/folio-sintetico']){location.pathname=path;expect(renderToStaticMarkup(<ReceptionOperationGate mode={mode} simpleNovelties/>)).toBe('');}
  });
  it('encendido no libera Caja, Llaves, Coordinación ni otras operaciones sin turno',()=>{
    for(const path of ['/caja','/llaves','/coordinacion','/libro-otro']){location.pathname=path;expect(renderToStaticMarkup(<ReceptionOperationGate mode="NO_SHIFT" simpleNovelties/>)).toContain('Operación bloqueada');}
  });
  it('un turno activo conserva el acceso anterior',()=>{location.pathname='/caja';expect(renderToStaticMarkup(<ReceptionOperationGate mode="ACTIVE"/>)).toBe('');});
});
