import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {EntryVisibilityFields} from '@/components/operational/entry-visibility';
describe('editar visibilidad con áreas desactivadas',()=>{
  it('conserva la casilla marcada de un área ya oculta aunque no figure en opciones activas',()=>{
    const html=renderToStaticMarkup(<EntryVisibilityFields departments={[{value:'active',label:'Recepción'}]} hiddenAreas={[{value:'inactive',label:'Administración (desactivada)'}]} hiddenDepartmentIds={['inactive']} />);
    expect(html).toContain('Administración (desactivada)');
    expect(html).toMatch(/name="hiddenDepartmentIds"[^>]*checked=""[^>]*value="inactive"|name="hiddenDepartmentIds"[^>]*value="inactive"[^>]*checked=""/);
  });
});
