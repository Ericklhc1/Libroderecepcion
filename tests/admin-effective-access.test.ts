import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORK_ACTIVITY_PRESETS } from '@/domain/work-activities';
import { safeListReturnHref } from '@/lib/list-navigation';

const activity = (key: string) => WORK_ACTIVITY_PRESETS.find((item) => item.key === key)!;

describe('Administración: actividades y acceso sin segundo motor', () => {
  it('las ayudas de Housekeeping no mezclan solicitar, ejecutar e inspeccionar', () => {
    expect(activity('housekeeping-request').permissions).toEqual(['housekeeping.request']);
    expect(activity('housekeeping-work').permissions).toEqual(['housekeeping.work']);
    expect(activity('housekeeping-inspect').permissions).toEqual(['housekeeping.inspect']);
  });

  it('garantías no concede otras operaciones de Caja', () => {
    expect(activity('cash-guarantees').permissions).toEqual([
      'cash.view',
      'cash.guarantee_in',
      'cash.guarantee_out',
    ]);
    expect(activity('cash-guarantees').permissions).not.toContain('cash.manual_out');
    expect(activity('cash-guarantees').permissions).not.toContain('cash.approve');
  });

  it('lencería usa únicamente los permisos canónicos de Inventario y Lavandería', () => {
    expect(activity('linen-management').available).toBe(true);
    expect(activity('linen-management').permissions).toEqual([
      'inventory.view',
      'inventory.move',
      'laundry.manage',
    ]);
    expect(activity('linen-management').permissions).not.toContain('inventory.manage');
  });

  it('la ficha explica acceso efectivo desde fuentes reales y sin suplantar sesión', () => {
    const page = readFileSync('src/app/(app)/admin/usuarios/page.tsx', 'utf8');
    expect(page).toContain('Acceso efectivo');
    expect(page).toContain('scheduleAreaGrants');
    expect(page).toContain('hkDelegationsReceived');
    expect(page).toContain('esta previsualización no suplanta una sesión real');
    expect(page).toContain('subjectDistributionEnabled');
  });
});

describe('Housekeeping fuera de Administración', () => {
  it('la ruta canónica contiene la operación y la histórica sólo redirige', () => {
    const canonical = readFileSync('src/app/(app)/housekeeping/page.tsx', 'utf8');
    const legacy = readFileSync('src/app/(app)/admin/housekeeping/page.tsx', 'utf8');
    expect(canonical).toContain('Trabajo del día');
    expect(canonical).toContain("operationalListHref('/housekeeping'");
    expect(legacy).toContain("redirect(operationalListHref('/housekeeping'");
    expect(legacy).not.toContain('getHkWorkday');
  });

  it('mantiene retornos históricos seguros durante la transición', () => {
    expect(safeListReturnHref('/admin/housekeeping?vista=mios&aviso=417', '/housekeeping'))
      .toBe('/admin/housekeeping?vista=mios&aviso=417');
  });
});
