import { describe, expect, it } from 'vitest';
import { groupDisplayRows } from '@/domain/display-groups';

describe('agrupación visual de duplicados', () => {
  it('conserva los enlaces, estados de lectura y orden de los originales', () => {
    const rows = [{ id: 'a', title: 'Revisar Caja', href: '/a', read: false }, { id: 'b', title: 'Llaves', href: '/b', read: false }, { id: 'c', title: 'Revisar Caja', href: '/c', read: true }];
    const groups = groupDisplayRows(rows, row => row.title);
    expect(groups.map(group => group.row.id)).toEqual(['a', 'b']);
    expect(groups[0].items).toEqual([rows[0], rows[2]]);
    expect(groups.flatMap(group => group.items).map(row => row.id).sort()).toEqual(['a', 'b', 'c']);
    expect(rows).toHaveLength(3);
  });
  it('no reúne avisos iguales de fuentes distintas ni concatena claves ambiguas', () => {
    const rows = [{ title: 'a|b', source: 'c' }, { title: 'a', source: 'b|c' }, { title: 'a', source: 'other' }];
    expect(groupDisplayRows(rows, row => JSON.stringify([row.title, row.source]))).toHaveLength(3);
  });
});
