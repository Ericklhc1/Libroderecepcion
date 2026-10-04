import {describe,it,expect} from 'vitest';
import {returnedSubjectTask} from '@/domain/subject-attention';
describe('resultado vigente del asunto',()=>{
  const done={procedureOccurrenceKey:'subject:test',status:'COMPLETADA',completedAt:new Date('2026-10-04T08:00:00Z')};
  it('ignora tareas ordinarias y pilotos aunque sean más recientes',()=>{
    expect(returnedSubjectTask([{...done,procedureOccurrenceKey:null},{...done,isDemo:true},done],null)).toBe(done);
    expect(returnedSubjectTask([{...done,procedureOccurrenceKey:null}],null)).toBeUndefined();
  });
  it('una atención nueva o reapertura posterior mantiene el resultado anterior como histórico',()=>{
    expect(returnedSubjectTask([{...done,status:'EN_CURSO',completedAt:null},done],null)).toBeUndefined();
    expect(returnedSubjectTask([done],new Date('2026-10-04T09:00:00Z'))).toBeUndefined();
  });
});
