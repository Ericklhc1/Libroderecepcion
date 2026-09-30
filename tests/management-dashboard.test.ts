import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@/lib/permissions';
import { NAV_ITEMS, visibleNavItems } from '@/components/layout/nav-items';

describe('Cockpit estratégico de Gerencia', () => {
  it('tiene un permiso dedicado y no se hereda por ser Supervisor', () => {
    expect(ROLE_PERMISSIONS[ROLE_KEYS.MANAGEMENT]).toContain('management.dashboard.view');
    expect(ROLE_PERMISSIONS[ROLE_KEYS.SUPERVISOR]).not.toContain('management.dashboard.view');
    expect(ROLE_PERMISSIONS[ROLE_KEYS.RECEPTIONIST]).not.toContain('management.dashboard.view');
    expect(ROLE_PERMISSIONS[ROLE_KEYS.RESERVATIONS_CENTER]).not.toContain('management.dashboard.view');
  });

  it('Gerencia aparece como módulo raíz sin convertir el sidebar en otro árbol', () => {
    const item = NAV_ITEMS.find((row) => row.href === '/gerencia');
    expect(item).toBeDefined();
    expect(item?.label).toBe('Gerencia');
    expect(item?.anyOf).toEqual(['management.dashboard.view']);
    expect(item?.menu).toBeUndefined();

    const visible = visibleNavItems(ROLE_PERMISSIONS[ROLE_KEYS.MANAGEMENT]).map((row) => row.href);
    expect(visible).toContain('/gerencia');
  });

  it('el servicio usa hechos operativos reales y no Alert legada', () => {
    const source = readFileSync('src/server/services/management.ts', 'utf8');

    expect(source).toContain('prisma.task.');
    expect(source).toContain('prisma.operationalEntry.');
    expect(source).toContain('prisma.shiftHandover.');
    expect(source).toContain('prisma.cashAudit.');
    expect(source).toContain('prisma.reservationReference.');
    expect(source).toContain('prisma.keyInventoryCount.');
    expect(source).toContain('prisma.checklistRun.');
    expect(source).toContain('prisma.correctiveMeasure.');
    expect(source).not.toContain('prisma.alert.');
  });

  it('el cockpit distingue datos conectados de métricas estratégicas futuras', () => {
    const page = readFileSync('src/app/(app)/gerencia/page.tsx', 'utf8');

    expect(page).toContain('Decisiones requeridas');
    expect(page).toContain('Scorecard ejecutivo');
    expect(page).toContain('Tendencia · actual vs. período anterior');
    expect(page).toContain('Calidad de la capa estratégica');
    expect(page).toContain('PMS comercial');
    expect(page).toContain('RevPAR');
    expect(page).toContain('GOPPAR');
    expect(page).toContain('Flow Through/Flex');
    expect(page).toContain('Fuente no conectada');
    expect(page).not.toMatch(/ranking|mejor empleado|peor empleado/i);
  });

  it('la semántica de Indicadores también usa OperationalAlarm', () => {
    const metrics = readFileSync('src/server/services/metrics.ts', 'utf8');
    expect(metrics).toContain('prisma.operationalAlarm.count');
    expect(metrics).toContain('OperationalAlarmStatus.ACTIVA');
    expect(metrics).not.toContain('prisma.alert.count');
  });

  it('Fronti reconoce la nueva pantalla como Gerencia', () => {
    const context = readFileSync('src/server/ai/fronti-v2/page-context.ts', 'utf8');
    expect(context).toContain("pathname === '/gerencia'");
    expect(context).toContain("detail('gerencia', 'Gerencia'");
  });
});
