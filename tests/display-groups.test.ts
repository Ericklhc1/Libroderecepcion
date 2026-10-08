import { describe, expect, it } from 'vitest';
import { groupDisplayRows } from '@/domain/display-groups';

describe('agrupación visual de duplicados', () => {
  it('conserva los enlaces, estados de lectura y orden de los originales', () => {
    const rows = [{ id: 'a', title: 'Revisar Caja', href: '/a', read: false }, { id: 'b', title: 'Llaves', href: '/b', read: false }, { id: 'c', title: 'Revisar Caja', href: '/c', read: true }];
    const groups = groupDisplayRows(rows, row => row.title);
    expect(groups.map(group => group.row.id)).toEqual(['a', 'b']);
    expect(groups[0]!.items).toEqual([rows[0], rows[2]]);
    expect(groups.flatMap(group => group.items).map(row => row.id).sort()).toEqual(['a', 'b', 'c']);
    expect(rows).toHaveLength(3);
  });
  it('no reúne avisos iguales de fuentes distintas ni concatena claves ambiguas', () => {
    const rows = [{ title: 'a|b', source: 'c' }, { title: 'a', source: 'b|c' }, { title: 'a', source: 'other' }];
    expect(groupDisplayRows(rows, row => JSON.stringify([row.title, row.source]))).toHaveLength(3);
  });
});

import { buildOperationalAttention } from '@/domain/operational-attention';
import { notificationDeviceItems, groupNotificationItems } from '@/domain/notification-summary';
it('cada seguimiento agrupado conserva una búsqueda por su propio folio',()=>{
  const rows=buildOperationalAttention({rooms:[],alerts:[],overdueTasks:[],criticalEntries:[],followUps:[{id:'one',humanId:501,action:'Duplicado',status:'PENDIENTE'},{id:'two',humanId:502,action:'Duplicado',status:'PENDIENTE'}]});
  expect(rows.map(row=>row.href)).toEqual(['/seguimientos?q=501&estado=todos','/seguimientos?q=502&estado=todos']);
});
it('agrupa los conteos de pisos por día hotelero y conserva los no leídos', () => {
  const base = { type:'FRONTI_HALLAZGO', body:null, entity:'KeyInventory', createdAt:'2026-10-08T02:00:00.000Z' };
  const rows = [ {...base,id:'a',title:'Inventario de llaves con diferencias · piso 1',entityId:'one',link:'/llaves?piso=1',readAt:'2026-10-08T02:01:00.000Z'}, {...base,id:'b',title:'Inventario de llaves con diferencias · piso 2',entityId:'two',link:'/llaves?piso=2',readAt:null} ];
  const groups = groupNotificationItems(rows);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.items.filter(item=>item.readAt===null)).toHaveLength(1);
  expect(groups[0]!.items.map(item=>item.link)).toEqual(['/llaves?piso=1','/llaves?piso=2']);
});

it('los duplicados exactos comparten presentación en campana, lista y push sin cambiar destino',()=>{
  const base={type:'COMENTARIO',title:'Revisar novedad',body:'Resultado',entity:'OperationalEntry',entityId:'e',createdAt:'2026-10-08T02:00:00Z',link:'/libro/e',readAt:null};
  const rows=[{...base,id:'a'},{...base,id:'b'}];
  const groups=groupNotificationItems(rows);expect(groups).toHaveLength(1);expect(groups[0]!.title).toBe(base.title);
  expect(notificationDeviceItems(rows)).toMatchObject([{link:'/libro/e',title:base.title}]);
});
it('agrupa todas las prioridades antes de elegir ocho grupos y conserva originales inferiores',()=>{
  const items=buildOperationalAttention({rooms:[],alerts:[],overdueTasks:Array.from({length:12},(_,i)=>({id:String(i),title:'Duplicada',priority:'CRITICA' as const})),criticalEntries:[{id:'distinct',humanId:1234,title:'Otra prioridad',priority:'ALTA',overdue:false}],followUps:[]},Number.POSITIVE_INFINITY);
  const groups=groupDisplayRows(items,item=>JSON.stringify([item.kind,item.tone,item.title,item.reason,item.action]));
  expect(groups).toHaveLength(2);expect(groups[0]!.items).toHaveLength(12);expect(groups.flatMap(group=>group.items).some(item=>item.id==='entry:distinct')).toBe(true);
});

it('los grupos presentan cuerpos compactos y mantienen identidades distintas para push',()=>{
  const base={type:'FRONTI_HALLAZGO',title:'Fronti · Tarea vencida',body:'x'.repeat(500),entity:'Task',entityId:'one',createdAt:'2026-10-08T02:00:00Z',link:'/coordinacion',readAt:null};
  const rows=[{...base,id:'a'},{...base,id:'b'}];
  const groups=groupNotificationItems(rows);expect(groups[0]!.body!.length).toBeLessThanOrEqual(240);
  expect(notificationDeviceItems([...rows,{...base,id:'c',entityId:'two'}])).toHaveLength(2);
});
