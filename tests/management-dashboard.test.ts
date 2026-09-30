import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@/lib/permissions';
import { NAV_ITEMS, visibleNavItems } from '@/components/layout/nav-items';

describe('Centro de Decisión Gerencial', () => {
  it('es un módulo raíz protegido por permiso gerencial', () => {
    const item = NAV_ITEMS.find((candidate) => candidate.href === '/gerencia');
    expect(item).toBeDefined();
    expect(item?.anyOf).toEqual(['management.dashboard.view']);

    for (const role of [ROLE_KEYS.MANAGEMENT, ROLE_KEYS.SUPERVISOR, ROLE_KEYS.SYSTEM_ADMIN]) {
      expect(ROLE_PERMISSIONS[role]).toContain('management.dashboard.view');
      expect(visibleNavItems(ROLE_PERMISSIONS[role]).map((row) => row.href)).toContain('/gerencia');
    }

    for (const role of [ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.NIGHT_AUDITOR, ROLE_KEYS.RESERVATIONS_CENTER]) {
      expect(ROLE_PERMISSIONS[role]).not.toContain('management.dashboard.view');
      expect(visibleNavItems(ROLE_PERMISSIONS[role]).map((row) => row.href)).not.toContain('/gerencia');
    }
  });

  it('la portada exige el permiso y evita una nota global opaca', () => {
    const page = readFileSync('src/app/(app)/gerencia/page.tsx', 'utf8');
    expect(page).toContain("requirePagePermission('management.dashboard.view')");
    expect(page).toContain('Sin score global');
    expect(page).toContain('Decisiones que requieren intervención');
    expect(page).toContain('Fragilidad operacional');
    expect(page).toContain('Perspectiva PMS / comercial');
  });

  it('las decisiones se construyen desde excepciones reales y no desde Alert legada', () => {
    const service = readFileSync('src/server/services/management-dashboard.ts', 'utf8');
    expect(service).toContain('getSupervisionData({ exhaustive: true })');
    expect(service).toContain('getOperationalHealth(currentRange)');
    expect(service).toContain('getReservationCenterSnapshot(now)');
    expect(service).not.toContain("key: 'alertas'");
    expect(service).toContain("key: 'garantias-integridad'");
    expect(service).toContain("key: 'caja'");
    expect(service).toContain("key: 'incidencias'");
  });

  it('la capa PMS muestra sólo métricas que existen en la evidencia importada', () => {
    const service = readFileSync('src/server/services/management-dashboard.ts', 'utf8');
    const page = readFileSync('src/app/(app)/gerencia/page.tsx', 'utf8');

    for (const metric of ['occupancyPct', 'revenueClp', 'adrClp', 'revparClp']) {
      expect(service).toContain(metric);
    }
    expect(page).toContain('AROH no estima GOP/GOPPAR');
    expect(service).not.toContain('goppar');
    expect(service).not.toContain('gopClp');
  });

  it('la migración concede lectura estratégica sólo a dirección y administración', () => {
    const migration = readFileSync(
      'prisma/migrations/20260930030000_centro_decision_gerencial/migration.sql',
      'utf8',
    );
    expect(migration).toContain("'management.dashboard.view'");
    expect(migration).toContain("'GERENCIA', 'SUPERVISOR', 'ADMINISTRADOR_SISTEMA'");
    expect(migration).not.toContain("'RECEPCIONISTA'");
    expect(migration).not.toContain("'AUDITOR_NOCTURNO'");
  });
});
