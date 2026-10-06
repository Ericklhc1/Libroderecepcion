import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
describe('Coordinación compacta conserva navegación y prioridad del trabajo',()=>{
  const page=readFileSync('src/app/(app)/coordinacion/page.tsx','utf8');
  it('expone tres vistas frecuentes y agrupa destinos secundarios',()=>{
    expect(page).toContain('shortcuts.slice(0,3)');expect(page).toContain('Otros módulos y herramientas');
    expect(page.indexOf('Vistas de coordinación')).toBeLessThan(page.indexOf('<ListFilterBar'));
    expect(page.indexOf('<ListFilterBar')).toBeLessThan(page.indexOf('Otros módulos y herramientas'));
    expect(page).not.toContain('observados." defaultOpen');
  });
  it('conserva todos los módulos, herramientas, filtros y vínculos al contexto',()=>{
    for(const href of ['/coordinacion/areas','/coordinacion/indicadores','/libro','/admin/housekeeping','/turno','/caja','/llaves','/custodia','/fronti/procedimientos','/coordinacion/automatizaciones']) expect(page).toContain(href);
    expect(page).toContain('operationalListHref');expect(page).toContain('detailHrefWithListContext');expect(page).toContain('Más vistas');expect(page).toContain('Más filtros');
  });
});
