import {expect,it} from 'vitest';
import {boundedPage,pageHref} from '@/lib/search-params';
it('limita valores de URL antes de construir offsets de Prisma',()=>{
  for(const value of [undefined,'','nada','Infinity','NaN','-20','0'])expect(boundedPage(value)).toBe(1);
  expect(boundedPage('2.9')).toBe(2);expect(boundedPage(['3','4'])).toBe(3);
  for(const value of ['9007199254740991','1e100'])expect(boundedPage(value)).toBe(100000);
  expect((boundedPage('9007199254740991')-1)*200).toBeLessThan(2147483647);
  expect(pageHref('/notificaciones',{q:'Origen',estado:'nuevas',pagina:'1'},2)).toBe('/notificaciones?q=Origen&estado=nuevas&pagina=2');
});
