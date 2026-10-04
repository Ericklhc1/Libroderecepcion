import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  addOrderedCandidate, candidateIsSelectable, candidateLabel,
  moveOrderedCandidate, removeOrderedCandidate, type SubstitutionCandidate,
} from '@/domain/substitution-candidates';

const technician: SubstitutionCandidate = {
  id: 'tech-id', name: 'Alex Pérez', username: 'aperez', role: 'Técnico',
  areas: [{ id: 'maintenance', name: 'Mantenimiento' }, { id: 'reception', name: 'Recepción' }],
  workKinds: ['task', 'entry'],
};
const housekeeper: SubstitutionCandidate = {
  id: 'hk-id', name: 'Alex Pérez', username: 'aperez_hsk', role: 'Mucama',
  areas: [{ id: 'housekeeping', name: 'Housekeeping' }], workKinds: ['housekeeping'],
};

describe('selector humano de suplentes: identidad y orden sin efectos operativos', () => {
  it('identifica los selectores por su etiqueta sin incorporar opciones al nombre accesible', () => {
    const source = readFileSync('src/components/operational/substitution-form.tsx', 'utf8');
    for (const [name, label] of [['workKind', 'Trabajo'], ['trigger', 'Condición'], ['priority', 'Prioridad'], ['mode', 'Modo'], ['requirePublishedSchedule', 'Horario']]) {
      expect(source).toContain(`name="${name}" aria-label="${label}"`);
    }
  });
  it('distingue personas homónimas por usuario, cargo y área, sin exponer IDs', () => {
    expect(candidateLabel(technician)).toBe('Alex Pérez · @aperez · Técnico · Mantenimiento, Recepción');
    expect(candidateLabel(housekeeper)).not.toEqual(candidateLabel(technician));
    expect(candidateLabel(technician)).not.toContain('tech-id');
  });
  it('filtra por pertenencia activa y tipo de trabajo recibidos del servidor', () => {
    expect(candidateIsSelectable(technician, 'maintenance', 'task')).toBe(true);
    expect(candidateIsSelectable(technician, 'reception', 'entry')).toBe(true);
    expect(candidateIsSelectable(technician, 'housekeeping', 'task')).toBe(false);
    expect(candidateIsSelectable(technician, 'maintenance', 'housekeeping')).toBe(false);
    expect(candidateIsSelectable(housekeeper, 'housekeeping', 'housekeeping')).toBe(true);
    expect(candidateIsSelectable(housekeeper, 'housekeeping', 'task')).toBe(false);
  });
  it('no agrega duplicados, valores vacíos ni cambia IDs por posiciones', () => {
    const ids = ['hk-id', 'tech-id'];
    expect(addOrderedCandidate(ids, 'hk-id')).toEqual(ids);
    expect(addOrderedCandidate(ids, '')).toEqual(ids);
    expect(addOrderedCandidate(ids, 'another-id')).toEqual(['hk-id', 'tech-id', 'another-id']);
    expect(ids).toEqual(['hk-id', 'tech-id']);
  });
  it('respeta el máximo nativo de veinte personas', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `person-${index}`);
    expect(addOrderedCandidate(ids, 'twenty-first')).toEqual(ids);
  });
  it('sube y baja por identidad conservando a todas las personas', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveOrderedCandidate(ids, 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveOrderedCandidate(ids, 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
  it('los límites y una selección obsoleta no reordenan otras identidades', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveOrderedCandidate(ids, 'a', -1)).toEqual(ids);
    expect(moveOrderedCandidate(ids, 'c', 1)).toEqual(ids);
    expect(moveOrderedCandidate(ids, 'missing', 1)).toEqual(ids);
  });
  it('quitar una persona no cambia la identidad ni orden relativo de las demás', () => {
    expect(removeOrderedCandidate(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(removeOrderedCandidate(['a', 'b'], 'missing')).toEqual(['a', 'b']);
  });
});
