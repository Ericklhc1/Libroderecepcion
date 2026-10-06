import { describe,expect,it } from 'vitest';
import { hkAllowedActions,hkInspectionRequired,hkNextStatus,isHkFocused } from '@/domain/housekeeping-work';
import { ROLE_KEYS,ROLE_PERMISSIONS } from '@/lib/permissions';
import { visibleNavGroups } from '@/components/layout/nav-items';
describe('Housekeeping: decisiones por cargo y estado',()=>{
  it('terminar limpieza obliga revisión y un impedimento no puede finalizarse',()=>{expect(hkInspectionRequired('LIMPIEZA',false)).toBe(true);expect(hkNextStatus('EN_GESTION','TERMINAR',true)).toBe('POR_REVISAR');expect(hkNextStatus('EN_GESTION','TERMINAR',false)).toBe('RESUELTO');expect(()=>hkNextStatus('BLOQUEADO','TERMINAR',true)).toThrow();expect(hkNextStatus('BLOQUEADO','ASIGNAR',true)).toBe('BLOQUEADO');});
  it('una instrucción cambiada suspende la inspección pendiente',()=>{expect(hkAllowedActions('POR_REVISAR',true,true)).toEqual(['RECONFIRMAR','IMPEDIMENTO','CANCELAR']);});
  it.each([ROLE_KEYS.HK_ATTENDANT,ROLE_KEYS.HK_SUPERVISOR,ROLE_KEYS.HK_MANAGER])('el cargo %s se limita a Housekeeping y horarios sin Caja o permisos técnicos',roleKey=>{const permissions=ROLE_PERMISSIONS[roleKey];expect(isHkFocused({roleKey,permissions})).toBe(true);expect(permissions).not.toContain('cash.view');expect(permissions).not.toContain('role.manage');expect(permissions).not.toContain('key.stock');expect(visibleNavGroups(permissions).flatMap(g=>g.items).some(i=>i.href==='/housekeeping')).toBe(true);});
  it('Recepción solicita atención sin recibir asignación ni inspección del área',()=>{const permissions=ROLE_PERMISSIONS[ROLE_KEYS.RECEPTIONIST];expect(permissions).toContain('housekeeping.request');expect(permissions).not.toContain('housekeeping.assign');expect(permissions).not.toContain('housekeeping.inspect');expect(isHkFocused({roleKey:ROLE_KEYS.RECEPTIONIST,permissions})).toBe(false);});
});
