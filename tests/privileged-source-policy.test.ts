import {describe,expect,it} from 'vitest';
import {entryReadWhere,canReadAllEntryAreas} from '@/server/services/entry-visibility';
import {followUpReadWhere,taskFollowUpReadWhere,notificationReadWhere} from '@/server/services/followup-access';
const supervisor={id:'privileged-reader',roleKey:'SUPERVISOR',permissions:['supervision.followup.manage']};
describe('proyección central de lectores con todas las áreas',()=>{
  it('omite sólo los cruces de área redundantes y conserva la privacidad ancestral',()=>{
    expect(canReadAllEntryAreas(supervisor)).toBe(true);
    const where=JSON.stringify(followUpReadWhere(supervisor));
    expect(where).not.toContain('sourceEntries');expect(where).not.toContain('entryId');expect(where).toContain('sourceFollowUps');expect(where).toContain('PRIVADO');expect(where).toContain(supervisor.id);
    expect(JSON.stringify(notificationReadWhere(supervisor))).not.toContain('sourceEntries');expect(JSON.stringify(notificationReadWhere(supervisor))).toContain('sourceFollowUps');
  });
  it('conserva el filtro de áreas en la fotografía compartida de Recepción y las políticas propuestas',()=>{
    const shared=JSON.stringify(followUpReadWhere(supervisor,false,true));expect(shared).toContain('sourceEntries');expect(shared).toContain('includeInReceptionHandover');expect(shared).toContain('RECEPCION');
    const proposed={hiddenFromDepartments:{none:{id:'proposed-area'}}};expect(JSON.stringify(taskFollowUpReadWhere(supervisor,false,proposed))).toContain('proposed-area');
  });
  it('ningún rol ordinario obtiene la excepción por permisos de gestión',()=>{
    const ordinary={...supervisor,roleKey:'GERENCIA'};expect(canReadAllEntryAreas(ordinary)).toBe(false);expect(JSON.stringify(followUpReadWhere(ordinary))).toContain('sourceEntries');expect(JSON.stringify(entryReadWhere(ordinary))).toContain('receptionInternal');
  });
});
