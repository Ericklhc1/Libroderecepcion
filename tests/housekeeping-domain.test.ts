import { describe, expect, it } from 'vitest';
import { ROLE_KEYS, ALL_PERMISSIONS } from '@/lib/permissions';
import { visibleNavGroups } from '@/components/layout/nav-items';
import { canAccessHousekeeping, housekeepingActions, housekeepingTransition } from '@/domain/housekeeping';

describe('Housekeeping privado: decisiones operativas', () => {
  it('habilita acceso y gestión mediante permisos, con acceso permanente del administrador', () => {
    expect(canAccessHousekeeping({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, permissions: [] })).toBe(true);
    for (const role of [ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.SUPERVISOR, 'ROL_PERSONALIZADO']) {
      expect(canAccessHousekeeping({ roleKey: role, permissions: [] })).toBe(false);
      expect(canAccessHousekeeping({ roleKey: role, permissions: ['housekeeping.view'] })).toBe(true);
      expect(canAccessHousekeeping({ roleKey: role, permissions: ['housekeeping.manage'] })).toBe(true);
    }
    expect(visibleNavGroups([]).flatMap((g) => g.items).some((i) => i.href === '/housekeeping')).toBe(false);
    expect(visibleNavGroups(['housekeeping.view']).flatMap((g) => g.items).some((i) => i.href === '/housekeeping')).toBe(true);
    expect(visibleNavGroups(ALL_PERMISSIONS, true).flatMap((g) => g.items).filter((i) => i.href === '/housekeeping')).toHaveLength(1);
  });
  it('confirmar recepción no resuelve ni inicia la tarea', () => {
    expect(housekeepingTransition('PENDIENTE', 'CONFIRMAR', false)).toBe('RECIBIDO');
    expect(housekeepingTransition('RECIBIDO', 'INICIAR', true)).toBe('EN_GESTION');
    expect(() => housekeepingTransition('PENDIENTE', 'RESOLVER', false)).toThrow();
  });
  it('pedir aclaración no confirma una instrucción incompleta', () => {
    expect(housekeepingTransition('PENDIENTE', 'ACLARAR', false)).toBe('BLOQUEADO');
    expect(() => housekeepingTransition('BLOQUEADO', 'RETOMAR', false)).toThrow('Confirma');
    expect(housekeepingTransition('BLOQUEADO', 'CONFIRMAR', false)).toBe('BLOQUEADO');
    expect(housekeepingTransition('BLOQUEADO', 'RETOMAR', true)).toBe('EN_GESTION');
  });
  it('una nueva versión exige confirmar antes de continuar', () => {
    expect(housekeepingActions('EN_GESTION', true)).toEqual(['CONFIRMAR', 'ACLARAR', 'CANCELAR']);
    expect(housekeepingTransition('EN_GESTION', 'CONFIRMAR', true)).toBe('EN_GESTION');
  });
  it('un bloqueo no se puede resolver sin retomar la gestión', () => {
    expect(() => housekeepingTransition('BLOQUEADO', 'RESOLVER', true)).toThrow();
    expect(housekeepingTransition('RESUELTO', 'REABRIR', true)).toBe('PENDIENTE');
  });
});
