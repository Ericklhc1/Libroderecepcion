import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('higiene funcional v1.10.9', () => {
  it('cierra todas las rutas profundas PMS que todavía eran mutables', () => {
    for (const path of [
      'src/app/(app)/huespedes/nueva-reserva/page.tsx',
      'src/app/(app)/huespedes/reservas/[id]/page.tsx',
      'src/app/(app)/reservas/[code]/page.tsx',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain("redirect('/libro?clase=entry')");
      expect(source).not.toContain('ActionForm');
      expect(source).not.toContain('guest.manage');
      expect(source).not.toContain('pms.import');
    }
  });

  it('separa Administración por intención y aísla la zona de riesgo', () => {
    const source = readFileSync('src/app/(app)/admin/page.tsx', 'utf8');
    for (const label of [
      'Personas y acceso',
      'Sistema',
      'Control y trazabilidad',
      'Mantenimiento',
      'Zona de riesgo',
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain("hrefs: ['/admin/puesta-en-cero']");
  });

  it('desambigua el turno de Supervisión frente al turno de Recepción', () => {
    const source = readFileSync('src/components/supervision/center-actions.tsx', 'utf8');
    expect(source).toContain('Iniciar turno de Supervisión');
    expect(source).toContain('Generar entrega de Supervisión');
    expect(source).toContain('Finalizar turno de Supervisión');
    expect(source).toContain('Confirmar recepción de Supervisión');
  });

  it('usa acciones explícitas en Alertas y recorridos', () => {
    const alerts = readFileSync('src/components/operational/alert-actions.tsx', 'utf8');
    const checks = readFileSync(
      'src/app/(app)/supervision/tablero/checklists.tsx',
      'utf8',
    );

    expect(alerts).toContain('Marcar como vista');
    expect(checks).toContain('Iniciar recorrido');
    expect(checks).toContain('Guardar resultado');
    expect(checks).toContain('Cerrar auditoría');
  });
});
