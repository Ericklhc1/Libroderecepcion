import {describe,it,expect} from 'vitest';
import {measuredDurations,periodChanges} from '@/domain/operational-indicators';
import type {CoordinationRow} from '@/server/services/coordination';
const from=new Date('2026-10-02T12:00:00Z'),to=new Date('2026-10-02T16:00:00Z');
const row={id:'sintetico',kind:'task',title:'Trabajo sintético',href:'/tareas/sintetico',owner:'Persona sintética',department:'Área',nextAction:'Revisar',createdAt:from,updatedAt:from,assignedAt:from,receivedAt:new Date('2026-10-02T12:30:00Z'),startedAt:null,completedAt:null} as CoordinationRow;
describe('Indicadores: hechos y denominadores',()=>{
 it('conserva datos faltantes y cuenta sólo eventos finales del período',()=>{const data=measuredDurations([row,{...row,id:'sinfecha',assignedAt:null},{...row,id:'fuera',receivedAt:new Date('2026-10-01T12:00:00Z')}],from,to);expect(data.receipt).toMatchObject({minutes:30,samples:1,denominator:2,missing:1});expect(data.resolution).toMatchObject({minutes:null,p95Minutes:null,samples:0,denominator:0});});
 it('no inventa transición por una actualización y enlaza su origen',()=>{const changes=periodChanges([{...row,createdAt:new Date('2026-10-01T12:00:00Z'),receivedAt:null}],from,to);expect(changes[0]).toMatchObject({created:false,received:false,completed:false,href:row.href});expect(changes[0]!.note).toContain('no permite reconstruir');});
});
