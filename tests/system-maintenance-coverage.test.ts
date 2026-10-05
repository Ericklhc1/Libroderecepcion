import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MAINTENANCE_SETTING_KEY } from '@/domain/system-maintenance';
import { DEFAULT_SETTINGS } from '@/server/services/settings';

const source = (file: string) => readFileSync(file, 'utf8');
const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const publicReadOnlyExceptions = new Set(['api/health/version/route.ts', 'api/maintenance/route.ts']);

function routesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? routesBelow(location) : entry.name === 'route.ts' ? [location] : [];
  }).sort();
}

function parse(file: string) {
  return ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function exported(node: ts.Node) {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function handlers(file: ts.SourceFile) {
  const found: Array<{ method: string; implementation?: ts.Node }> = [];
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && httpMethods.has(declaration.name.text)) {
          found.push({ method: declaration.name.text, implementation: declaration.initializer });
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && exported(statement) && statement.name && httpMethods.has(statement.name.text)) {
      found.push({ method: statement.name.text, implementation: statement });
    } else if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) throw new Error(`${file.fileName}: no se puede verificar export * en una ruta operativa`);
      if (ts.isNamedExports(statement.exportClause)) {
        for (const entry of statement.exportClause.elements) {
          // An unverified alias/re-export must not silently bypass the inventory.
          if (httpMethods.has(entry.name.text)) found.push({ method: entry.name.text });
        }
      }
    }
  }
  return found;
}

function functionBody(file: string, name: string) {
  const ast = parse(file);
  const declaration = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  if (!declaration || !ts.isFunctionDeclaration(declaration) || !declaration.body) throw new Error(`Falta ${name} en ${file}`);
  return declaration.body.getText(ast);
}

const apiRoutes = routesBelow('src/app/api');

describe('mantenimiento temporal · inventario de todas las puertas API', () => {
  it('el inventario recorre las rutas reales y limita las excepciones a dos lecturas públicas', () => {
    expect(apiRoutes.length).toBeGreaterThanOrEqual(55);
    expect(apiRoutes.filter(file => publicReadOnlyExceptions.has(path.relative('src/app', file))).sort()).toEqual([
      'src/app/api/health/version/route.ts', 'src/app/api/maintenance/route.ts',
    ]);
  });

  for (const file of apiRoutes) {
    const relative = path.relative('src/app', file);
    if (publicReadOnlyExceptions.has(relative)) {
      it(`${relative}: la excepción sólo exporta GET y no realiza escrituras`, () => {
        const ast = parse(file);
        expect(handlers(ast).map(handler => handler.method)).toEqual(['GET']);
        expect(source(file)).not.toMatch(/\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/);
        expect(source(file)).toContain("'Cache-Control': 'no-store'");
      });
    } else if (relative.startsWith('api/cron/')) {
      it(`${relative}: autentica y omite el trabajo antes de invocar sus servicios`, () => {
        const ast = parse(file);
        const exportedHandlers = handlers(ast);
        expect(exportedHandlers.length).toBeGreaterThan(0);
        expect(source(file)).toContain("import { maintenanceCronResponse } from '@/server/api/maintenance'");
        for (const handler of exportedHandlers) {
          expect(handler.implementation && ts.isFunctionDeclaration(handler.implementation), `${relative} ${handler.method}`).toBe(true);
          if (!handler.implementation || !ts.isFunctionDeclaration(handler.implementation)) continue;
          const statements = handler.implementation.body?.statements ?? [];
          expect(statements[0]?.getText(ast)).toContain('isAuthorizedCronRequest(request)');
          expect(statements[0]?.getText(ast)).toContain('401');
          expect(statements[1]?.getText(ast)).toMatch(/await maintenanceCronResponse\(\)/);
          expect(statements[2]?.getText(ast)).toMatch(/if\s*\(maintenance\)\s*return maintenance/);
        }
      });
    } else {
      it(`${relative}: cada método HTTP exportado está envuelto por withMaintenance`, () => {
        const ast = parse(file);
        const exportedHandlers = handlers(ast);
        expect(exportedHandlers.length, `No se verificó ningún handler de ${relative}`).toBeGreaterThan(0);
        expect(source(file)).toContain("import { withMaintenance } from '@/server/api/maintenance'");
        for (const { method, implementation } of exportedHandlers) {
          expect(implementation && ts.isCallExpression(implementation), `${relative} ${method} no tiene wrapper`).toBe(true);
          if (!implementation || !ts.isCallExpression(implementation)) continue;
          expect(implementation.expression.getText(ast), `${relative} ${method}`).toBe('withMaintenance');
          expect(implementation.arguments.length).toBe(1);
        }
      });
    }
  }
});

describe('mantenimiento temporal · guards, control y presentación', () => {
  it('los guards canónicos de acciones y páginas consultan mantenimiento antes de devolver el usuario', () => {
    const authenticated = functionBody('src/server/auth/guard.ts', 'requireAuthenticatedUser');
    expect(authenticated).toContain('await assertMaintenanceAccess(user)');
    expect(authenticated.indexOf('assertMaintenanceAccess(user)')).toBeLessThan(authenticated.indexOf('return user'));
    expect(functionBody('src/server/auth/guard.ts', 'requireUser')).toContain('await requireAuthenticatedUser()');
    for (const name of ['requirePermission', 'requirePermissionOrOwner']) {
      expect(functionBody('src/server/auth/guard.ts', name)).toContain('await requireUser()');
    }
    const page = functionBody('src/server/auth/guard.ts', 'requirePageUser');
    expect(page).toContain('await assertMaintenanceAccess(user)');
    expect(page).toContain("redirect('/mantenimiento')");
    expect(page.indexOf('assertMaintenanceAccess(user)')).toBeLessThan(page.indexOf('if (!options.allowIncompleteAccess)'));
    for (const name of ['requirePagePermission', 'requirePageAnyPermission']) {
      expect(functionBody('src/server/auth/guard.ts', name)).toContain('await requirePageUser(');
    }
  });

  it('el layout bloquea antes de sus lecturas operativas y conserva aviso/reapertura administrativa', () => {
    const layout = source('src/app/(app)/layout.tsx');
    expect(layout.indexOf('assertMaintenanceAccess(user)')).toBeGreaterThan(0);
    expect(layout.indexOf('assertMaintenanceAccess(user)')).toBeLessThan(layout.indexOf('await Promise.all('));
    expect(layout).toContain("redirect('/mantenimiento')");
    expect(layout).toContain('!user.isSystemAdmin && <MaintenanceWatcher');
    expect(layout).toContain('user.isSystemAdmin && (await getMaintenanceState()).enabled');
    expect(layout).toContain('href="/admin/mantenimiento"');
    expect(layout).toContain('Mantenimiento activo');
  });

  it('la consola propia exige SysAdmin y el editor genérico no puede modificar esta clave', () => {
    const page = source('src/app/admin/mantenimiento/page.tsx');
    expect(page).toContain("if (!user.isSystemAdmin) redirect('/sin-permisos')");
    expect(page.indexOf('if (!user.isSystemAdmin)')).toBeLessThan(page.indexOf('await getMaintenanceState()'));
    expect(page).toContain('<SystemMaintenanceForm state={state}');
    expect(page).toContain('No hay reapertura automática');
    expect(page).toContain('ya estaban ejecutándose');
    expect(page).toContain('!state.valid');
    expect(page).toContain('MAINTENANCE_MESSAGE');
    expect(Object.hasOwn(DEFAULT_SETTINGS, MAINTENANCE_SETTING_KEY)).toBe(false);
    expect(functionBody('src/server/actions/admin.ts', 'saveSettingAction')).toContain('input.key in DEFAULT_SETTINGS');
    const adminPage = source('src/app/(app)/admin/page.tsx');
    expect(adminPage).toMatch(/user\.isSystemAdmin\s*\?\s*\(\s*<Link href="\/admin\/mantenimiento"/);
  });

  it('la recuperación queda fuera del shell operativo sin omitir autenticación ni primer acceso', () => {
    const page = source('src/app/admin/mantenimiento/page.tsx');
    expect(existsSync('src/app/(app)/admin/mantenimiento/page.tsx')).toBe(false);
    expect(page).toContain('await requirePageUser({ allowAreaOperation: true })');
    expect(page).not.toContain('allowIncompleteAccess');
    expect(page).not.toMatch(/AnnouncementGate|TutorialTour|ReceptionOperationGate/);
    expect(source('src/app/layout.tsx')).not.toMatch(/AnnouncementGate|TutorialTour|ReceptionOperationGate/);
    expect(functionBody('src/server/actions/system-maintenance.ts', 'setSystemMaintenanceAction')).toContain('await requireUser()');
  });

  it('el formulario envía revisión y confirmación, sin permitir editar el mensaje canónico', () => {
    const form = source('src/components/admin/system-maintenance-form.tsx');
    expect(form).toContain('action={setSystemMaintenanceAction}');
    expect(form).toContain('name="revision" value={state.revision}');
    expect(form).toContain('name="confirm" required');
    expect(form).toContain('key={state.revision}');
    expect(form).not.toContain('name="message"');
    const action = functionBody('src/server/actions/system-maintenance.ts', 'setSystemMaintenanceAction');
    expect(action).toContain('await requireUser()');
    expect(action).toContain("confirm: z.literal('on')");
    expect(action).toContain('expectedRevision: input.revision');
    expect(action).toContain("revalidatePath('/', 'layout')");
  });

  it('el aviso público es dinámico, permite volver a comprobar y mantiene acceso al administrador', () => {
    const page = source('src/app/mantenimiento/page.tsx');
    expect(page).toContain("dynamic = 'force-dynamic'");
    expect(page).toContain('getMaintenanceState().catch(');
    expect(page).toContain('enabled: true, message: MAINTENANCE_MESSAGE');
    expect(page).toContain('<p role="status">{state.message}</p>');
    expect(page).toContain("if (!state.enabled) redirect('/')");
    expect(page).toContain('Comprobar disponibilidad');
    expect(page).toContain('href="/login"');
    expect(page).toContain('user?.isSystemAdmin');
    expect(page).toContain('href="/admin/mantenimiento"');
    expect(source('src/app/login/page.tsx')).toContain('maintenance.enabled');
  });

  it('los clientes ya abiertos reconsultan sin caché y liberan listeners al desmontar', () => {
    const watcher = source('src/components/operational/maintenance-watcher.tsx');
    expect(watcher).toContain("fetch('/api/maintenance', { cache: 'no-store' })");
    expect(watcher).toContain("window.location.assign('/mantenimiento')");
    expect(watcher).toContain('window.setInterval(');
    expect(watcher).toContain('window.clearInterval(timer)');
    expect(watcher).toContain("window.removeEventListener('focus', onFocus)");
    expect(watcher).toContain("document.removeEventListener('visibilitychange', onFocus)");
    expect(watcher).toContain('!disposed && state.enabled === true');
  });

  it('el control no depende de una variable de despliegue, cookie, caché de proceso ni temporizador de reapertura', () => {
    const service = source('src/server/services/system-maintenance.ts');
    expect(service).toContain('prisma.systemSetting.findUnique');
    expect(service).toContain('prisma.$transaction');
    expect(service).toContain('pg_advisory_xact_lock');
    expect(service).toContain('await tx.auditLog.create');
    expect(service).not.toMatch(/process\.env|localStorage|cookies\(|unstable_cache|setTimeout\(|setInterval\(/);
  });
});
