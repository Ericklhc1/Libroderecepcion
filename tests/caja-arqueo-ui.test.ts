import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const forms = readFileSync('src/components/cash/live-cash-forms.tsx', 'utf-8');
const dialog = readFileSync('src/components/ui/dialog.tsx', 'utf-8');
const page = readFileSync('src/app/(app)/caja/page.tsx', 'utf-8');

describe('flujo visual del arqueo de Caja', () => {
  it('Validar es una acción real y no una casilla pasiva', () => {
    const audit = forms.slice(forms.indexOf('export function LiveCashAuditForm'), forms.indexOf('export function LiveCashAuditDialog'));
    expect(audit).toContain('toggleGuarantee');
    expect(audit).toContain('aria-pressed={validated}');
    expect(audit).toContain("'Validar'");
    expect(audit).toContain('Validada');
    expect(audit).not.toContain('type="checkbox"');
  });

  it('sólo envía al servidor las garantías explícitamente validadas', () => {
    expect(forms).toContain('validatedIds.has(guarantee.id)');
    expect(forms).toContain('type="hidden" name={`g_${guarantee.id}`} value="1"');
    expect(forms).toContain('disabled={!allGuaranteesValidated}');
  });

  it('después de guardar cambia a una ventana de éxito con Aceptar', () => {
    expect(forms).toContain('setAuditOpen(false)');
    expect(forms).toContain('setSuccessOpen(true)');
    expect(forms).toContain('Arqueo guardado correctamente');
    expect(forms).toMatch(/Aceptar/);
    expect(forms).toContain('router.refresh()');
  });

  it('el diálogo soporta control externo y una confirmación no descartable', () => {
    expect(dialog).toContain('open: controlledOpen');
    expect(dialog).toContain('onOpenChange');
    expect(dialog).toContain('dismissible = true');
    expect(dialog).toContain('dismissible && event.target === event.currentTarget');
  });

  it('Caja usa el flujo compuesto y no el formulario aislado', () => {
    expect(page).toContain('LiveCashAuditDialog');
    expect(page).not.toContain('<LiveCashAuditForm');
  });
});
