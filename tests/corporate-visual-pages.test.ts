import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SITE_ROOT = join(process.cwd(), 'src', 'app');
const COMPONENTS_ROOT = join(process.cwd(), 'src', 'components');
const APP_ROOT = join(SITE_ROOT, '(app)');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function routeForPage(path: string): string {
  const local = relative(SITE_ROOT, path).split(sep).join('/');
  const withoutPage = local === 'page.tsx' ? '' : local.replace(/\/page\.tsx$/, '');
  return '/' + withoutPage;
}

describe('sistema visual corporativo · cobertura total de pantallas', () => {
  const pages = walk(SITE_ROOT).filter((path) => path.endsWith(sep + 'page.tsx'));

  it('recorre todas las pantallas actuales, incluidas entradas públicas', () => {
    expect(pages.length).toBeGreaterThanOrEqual(50);
  });

  it('ninguna pantalla ni componente visual hardcodea una geometría paralela al sistema global', () => {
    const visualFiles = [
      ...pages,
      ...walk(COMPONENTS_ROOT).filter((path) => /\.tsx$/.test(path)),
    ];
    const offenders = visualFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const reasons: string[] = [];
      if (/rounded-\[[^\]]+\]/.test(source)) reasons.push('radio arbitrario');
      if (/borderRadius\s*:/.test(source)) reasons.push('borderRadius inline');
      if (/fontFamily\s*:/.test(source)) reasons.push('fontFamily inline');
      if (/font-family\s*:/.test(source)) reasons.push('font-family inline');
      const label = path.startsWith(SITE_ROOT)
        ? routeForPage(path)
        : relative(process.cwd(), path).split(sep).join('/');
      return reasons.map((reason) => `${label}: ${reason}`);
    });

    expect(offenders, 'Pantallas fuera del sistema visual: ' + offenders.join(', ')).toEqual([]);
  });

  it('el shell autenticado aplica la identidad corporativa a todas las rutas', () => {
    const layout = readFileSync(join(APP_ROOT, 'layout.tsx'), 'utf8');
    expect(layout).toContain("bg-[var(--aroh-canvas)]");
    expect(layout).toContain('<DesktopNav groups={groups} badges={badges} />');
    expect(layout).not.toContain('<AppSidebar');
    expect(readFileSync('src/components/layout/app-sidebar.tsx', 'utf8')).toContain('bg-petrol-950 lg:flex');
  });

  it('las entradas públicas también usan la identidad compartida', () => {
    const login = readFileSync(join(SITE_ROOT, 'login', 'page.tsx'), 'utf8');
    const install = readFileSync(join(SITE_ROOT, 'instalacion', 'page.tsx'), 'utf8');
    expect(login).toContain('bg-petrol-950');
    expect(install).toContain('bg-petrol-950');
  });

  it('los tokens globales controlan geometría, superficies y neutrales', () => {
    const config = readFileSync('tailwind.config.ts', 'utf8');
    const css = readFileSync('src/app/globals.css', 'utf8');

    expect(config).toContain("50: '#f8fafc'");
    expect(config).toContain("100: '#f1f5f9'");
    expect(config).toContain("lg: '8px'");
    expect(config).toContain('plugins: [appearanceUtilities]');
    expect(css).toContain('border border-slate-200 bg-white shadow-card');
    expect(css).toContain('background-color: var(--aroh-subtle)');
  });
});
