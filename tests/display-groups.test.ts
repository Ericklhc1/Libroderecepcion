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

import { groupNotificationItems } from '@/domain/notification-summary';
it('agrupa los conteos de pisos por día hotelero y conserva los no leídos', () => {
  const base = { type:'FRONTI_HALLAZGO', body:null, entity:'KeyInventory', createdAt:'2026-10-08T02:00:00.000Z' };
  const rows = [ {...base,id:'a',title:'Inventario de llaves con diferencias · piso 1',entityId:'one',link:'/llaves?piso=1',readAt:'2026-10-08T02:01:00.000Z'}, {...base,id:'b',title:'Inventario de llaves con diferencias · piso 2',entityId:'two',link:'/llaves?piso=2',readAt:null} ];
  const groups = groupNotificationItems(rows);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.items.filter(item=>item.readAt===null)).toHaveLength(1);
  expect(groups[0]!.items.map(item=>item.link)).toEqual(['/llaves?piso=1','/llaves?piso=2']);
});
