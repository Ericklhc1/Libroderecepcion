import { describe, expect, it } from 'vitest';
import { ROLE_KEYS, ALL_PERMISSIONS } from '@/lib/permissions';
import { visibleNavGroups } from '@/components/layout/nav-items';
import { canAccessHousekeeping, housekeepingActions, housekeepingTransition } from '@/domain/housekeeping';

describe('Housekeeping privado: decisiones operativas', () => {
  it('solo permite el rol administrador, aunque otros tengan permisos técnicos', () => {
    for (const role of Object.values(ROLE_KEYS)) expect(canAccessHousekeeping(role)).toBe(role === ROLE_KEYS.SYSTEM_ADMIN);
    expect(canAccessHousekeeping('ROL_PERSONALIZADO')).toBe(false);
    expect(visibleNavGroups(ALL_PERMISSIONS).flatMap((g) => g.items).some((i) => i.href === '/admin/housekeeping')).toBe(false);
    expect(visibleNavGroups(ALL_PERMISSIONS, true).flatMap((g) => g.items).some((i) => i.href === '/admin/housekeeping')).toBe(true);
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
