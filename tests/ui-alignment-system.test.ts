import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

describe('alineación visual transversal AROH', () => {
  it('equilibra las tarjetas de Novedades / habitación', () => {
    const roomPage = source('src/app/(app)/novedades/habitacion/page.tsx');

    expect(roomPage).toContain('flex h-full min-h-[8.5rem] flex-col');
    expect(roomPage).toContain('mt-auto grid grid-cols-2');
    expect(roomPage).toContain("metrics.length % 2 === 1");
    expect(roomPage).toContain("'col-span-2'");
    expect(roomPage).toContain('items-center justify-between');
    expect(roomPage).toContain('text-center text-xs font-medium text-slate-400');
  });

  it('mantiene geometría estable en los controles compartidos', () => {
    const button = source('src/components/ui/button.tsx');
    const badge = source('src/components/ui/badge.tsx');
    const css = source('src/app/globals.css');

    expect(button).toContain("sm: 'min-h-8");
    expect(button).toContain("md: 'min-h-9");
    expect(button).toContain("lg: 'min-h-11");
    expect(button).toContain('items-center justify-center');

    expect(badge).toContain('min-h-5 items-center justify-center');
    expect(badge).toContain('leading-none');

    expect(css).toContain('@apply min-h-10 w-full rounded-md');
    expect(css).toContain('@apply min-w-0 rounded-lg border');
    expect(css).toContain('@apply flex min-h-11 items-center justify-between');
  });

  it('alinea el shell y conserva diálogos centrados respecto del viewport', () => {
    const layout = source('src/app/(app)/layout.tsx');
    const dialog = source('src/components/ui/dialog.tsx');

    expect(layout).toContain('max-w-[1680px] min-w-0 items-center gap-2 px-4 py-2');
    expect(layout).toContain('max-w-[1680px] flex-1 px-4');

    expect(dialog).toContain('50vw');
    expect(dialog).toContain('50dvh');
  });
});
