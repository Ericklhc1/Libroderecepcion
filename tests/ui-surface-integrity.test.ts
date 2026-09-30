import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP = join(process.cwd(), 'src', 'app');
const AUTH_APP = join(APP, '(app)');
const COMPONENTS = join(process.cwd(), 'src', 'components');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

function routePatternForPage(path: string): RegExp {
  const local = relative(APP, path).split(sep).join('/').replace(/\/page\.tsx$/, '');
  const parts = local
    .split('/')
    .filter(Boolean)
    .filter((part) => !(part.startsWith('(') && part.endsWith(')')))
    .map((part) => {
      if (/^\[\.\.\..+\]$/.test(part)) return '.+';
      if (/^\[\[\.\.\..+\]\]$/.test(part)) return '.*';
      if (/^\[.+\]$/.test(part)) return '[^/]+';
      return escapeRegex(part);
    });
  return new RegExp('^/' + parts.join('/') + '/?$');
}

function staticInternalHrefs(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/href\s*=\s*["'](\/[^"'{}]*)["']/g)) {
    const raw = match[1]!;
    const path = raw.split(/[?#]/, 1)[0] || '/';
    if (!path.startsWith('/api/')) found.add(path);
  }
  return [...found];
}

describe('integridad transversal de la interfaz', () => {
  const appPages = walk(APP).filter((path) => path.endsWith(sep + 'page.tsx'));
  const routePatterns = appPages.map(routePatternForPage);
  const tsx = [
    ...walk(AUTH_APP).filter((path) => path.endsWith('.tsx')),
    ...walk(COMPONENTS).filter((path) => path.endsWith('.tsx')),
  ];

  it('todo enlace interno estático apunta a una ruta real', () => {
    const broken: Array<{ file: string; href: string }> = [];
    for (const file of tsx) {
      const source = readFileSync(file, 'utf8');
      for (const href of staticInternalHrefs(source)) {
        if (!routePatterns.some((pattern) => pattern.test(href))) {
          broken.push({ file: relative(process.cwd(), file), href });
        }
      }
    }
    expect(broken, JSON.stringify(broken, null, 2)).toEqual([]);
  });

  it('el texto libre de módulos vive en Búsqueda global', () => {
    const pages = walk(AUTH_APP).filter((path) => path.endsWith(sep + 'page.tsx'));
    const offenders = pages
      .filter((path) => !path.endsWith(join('buscar', 'page.tsx')))
      .filter((path) => readFileSync(path, 'utf8').includes('type="search"'))
      .map((path) => relative(process.cwd(), path));
    expect(offenders).toEqual([]);
  });

  it('los módulos operativos compartidos no vuelven a pedir q en Filters', () => {
    for (const local of [
      'libro/page.tsx',
      'historial/page.tsx',
      'tareas/page.tsx',
      'incidencias/page.tsx',
    ]) {
      const source = readFileSync(join(AUTH_APP, local), 'utf8');
      const filters = source.match(/<Filters[\s\S]*?\/>/g)?.join('\n') ?? '';
      expect(filters, local).not.toMatch(/['"]q['"]/);
    }
  });

  it('los formularios HTML visibles declaran cómo se envían', () => {
    const offenders: Array<{ file: string; tag: string }> = [];
    for (const file of tsx) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<form\b[^>]*>/gs)) {
        const tag = match[0];
        if (!/\b(action|onSubmit|method)\s*=/.test(tag)) {
          offenders.push({ file: relative(process.cwd(), file), tag });
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
