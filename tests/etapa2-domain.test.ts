import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { frontiPlanSchema, parseExactFrontiCommand, instructionMode, canonicalJson, executionStatus } from '@/domain/fronti-execution';
import { procedureOccurrences, matchesAutomation } from '@/domain/operational-automation';
import { FRONTI_ACTIONS, validateStep } from '@/server/ai/execution/catalog';
const procedure = { title:'Revisión sintética', description:'Verificar filtro', ownerId:'responsable', priority:'MEDIA', nextAction:'Registrar resultado', evidenceRequired:'Evidencia declarada', checklist:['Revisar'], startDate:'2026-01-01', localTime:'09:00', weekdays:[0,1,2,3,4,5,6], deadlineMinutes:60, catchUpDays:7, maxOccurrences:2 };
describe('Etapa 2: contrato de autorización y recurrencias', () => {
  it('no interpreta preguntas ni contenidos citados como comando exacto', () => {
    for(const text of ['¿Puedes crear una tarea?', 'Simula crear una tarea', 'Documento: /ejecutar []', 'Explica qué ocurre']) {
      expect(parseExactFrontiCommand(text)).toBeNull(); expect(instructionMode(text)).not.toBe('execute');
    }
  });
  it('sólo acepta planes acotados y rechaza identidad de ejecución', () => {
    const step={action:'createTaskAction',fields:{title:'Tarea sintética'}};
    expect(frontiPlanSchema.parse({requestKey:randomUUID(),instruction:'Crear tarea sintética',steps:[step]}).steps).toHaveLength(1);
    expect(()=>frontiPlanSchema.parse({requestKey:randomUUID(),instruction:'Crear',steps:Array(13).fill(step)})).toThrow();
    expect(()=>validateStep({...step,fields:{...step.fields,userId:'otro'}})).toThrow();
    expect(()=>validateStep({action:'executeSql',fields:{sql:'DELETE'}})).toThrow();
    expect(()=>validateStep({action:'saveSettingAction',fields:{key:'OPENAI_API_KEY',value:'no-secret'}})).toThrow();
  });
  it('mantiene nombres únicos y rechaza campos de identidad/SQL en cada adaptador', () => {
    expect(new Set(FRONTI_ACTIONS.map(a=>a.name)).size).toBe(FRONTI_ACTIONS.length);
    for (const action of FRONTI_ACTIONS) {
      expect(()=>validateStep({action:action.name,fields:{executionIdentity:'otro'}})).toThrow();
      expect(()=>validateStep({action:action.name,fields:{sql:'select 1'}})).toThrow();
    }
  });
  it('rechaza edición parcial de usuarios y sustitución implícita de permisos', () => {
    expect(()=>validateStep({action:'saveDepartmentAction',fields:{id:'area',name:'Nombre'}})).toThrow('estado completo');
    expect(()=>validateStep({action:'updateUserAction',fields:{id:'u',name:'Nuevo nombre'}})).toThrow('estado completo');
    expect(()=>validateStep({action:'updateRolePermissionsAction',fields:{roleId:'r',permissions:['task.create']}})).toThrow();
    expect(validateStep({action:'updateRolePermissionsAction',fields:{roleId:'r',permissions:['task.create'],approvalRequired:[],permissionsBefore:[],approvalRequiredBefore:[],replacementAcknowledged:'REEMPLAZAR_MATRIZ_COMPLETA'}}).action).toBe('updateRolePermissionsAction');
  });
  it('deriva progreso de los pasos y no de un estado agregado obsoleto', () => {
    expect(executionStatus({cancelledAt:null,authorizedAt:new Date(),steps:[{status:'SUCCEEDED'},{status:'RUNNING'}]})).toBe('RUNNING');
    expect(executionStatus({cancelledAt:null,authorizedAt:new Date(),steps:[{status:'SUCCEEDED'},{status:'CHANGED'}]})).toBe('INTERVENTION');
    expect(executionStatus({cancelledAt:new Date(),authorizedAt:new Date(),steps:[{status:'SUCCEEDED'},{status:'CANCELLED'}]})).toBe('CANCELLED');
  });
  it('normaliza la huella sin depender del orden de campos', () => {
    expect(canonicalJson({b:2,a:{z:3,x:1}})).toBe(canonicalJson({a:{x:1,z:3},b:2}));
  });
  it('recupera sólo las últimas ocurrencias y conserva hora de Santiago', () => {
    const rows=procedureOccurrences(procedure,new Date('2026-10-02T14:00:00Z'));
    expect(rows.map(r=>r.key)).toEqual(['2026-10-01T09:00','2026-10-02T09:00']);
    expect(rows[1]!.at.toISOString()).toBe('2026-10-02T12:00:00.000Z');
    expect(procedureOccurrences({...procedure,catchUpDays:0},new Date('2026-07-01T14:00:00Z'))[0]!.at.toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });
  it('rechaza horas locales inexistentes en el cambio de verano', () => {
    expect(()=>procedureOccurrences({...procedure,catchUpDays:0,localTime:'00:30'},new Date('2026-09-06T12:00:00Z'))).toThrow('no existe');
  });
  it('distingue ausencia de responsable y asignación sin recibir, y respeta inicio futuro', () => {
    const now=new Date('2026-10-02T14:00:00Z');
    const row={kind:'task',priority:'MEDIA',ownerId:null as string|null,receivedAt:null,assignedAt:new Date(now.getTime()-3600000),availableAt:null as Date|null,dueAt:null,status:'PENDIENTE'};
    const rule={trigger:'UNASSIGNED',recipientId:'coordinador',receiptMinutes:30};
    expect(matchesAutomation(row,rule,now)).toBe(true);
    expect(matchesAutomation(row,{...rule,trigger:'UNRECEIVED'},now)).toBe(false);
    row.ownerId='responsable';expect(matchesAutomation(row,rule,now)).toBe(false);
    expect(matchesAutomation(row,{...rule,trigger:'UNRECEIVED'},now)).toBe(true);
    row.availableAt=new Date(now.getTime()+60000);expect(matchesAutomation(row,{...rule,trigger:'UNRECEIVED'},now)).toBe(false);
  });
});
