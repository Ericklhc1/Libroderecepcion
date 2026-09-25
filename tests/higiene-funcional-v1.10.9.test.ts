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

  it('retira la programación histórica de turnos de la interfaz y la ayuda', () => {
    const adminForms = readFileSync('src/app/(app)/admin/admin-forms.tsx', 'utf8');
    const help = readFileSync('src/domain/help.ts', 'utf8');
    const install = readFileSync('src/app/instalacion/page.tsx', 'utf8');

    expect(adminForms).not.toContain('ScheduleShiftForm');
    expect(adminForms).not.toContain('scheduleShiftAction');
    expect(adminForms).not.toContain("value: 'MANANA'");
    expect(adminForms).not.toContain("value: 'TARDE'");
    expect(help).not.toContain("id: 'turno-largo'");
    expect(help).not.toContain('¿Cómo programo un turno');
    expect(install).not.toContain('programarás los turnos');
    expect(install).toContain('configurarás el sistema');
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
