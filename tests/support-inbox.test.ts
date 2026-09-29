import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@/lib/permissions';

describe('bandeja interna de soporte', () => {
  const route = readFileSync('src/app/api/soporte/solicitud/route.ts', 'utf8');
  const page = readFileSync('src/app/(app)/admin/soporte/page.tsx', 'utf8');
  const action = readFileSync('src/server/actions/support.ts', 'utf8');
  const nav = readFileSync('src/components/layout/nav-items.ts', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260929145000_support_inbox/migration.sql',
    'utf8',
  );

  it('guarda el reporte antes de intentar el aviso por correo', () => {
    expect(route).toContain('prisma.supportRequest.create');
    expect(route).toContain('sendMail({');
    expect(route.indexOf('prisma.supportRequest.create')).toBeLessThan(
      route.indexOf('sendMail({'),
    );
    expect(route).toContain('emailSent: mailSent');
    expect(route).toContain('Reporte registrado');
  });

  it('separa lectura y gestión mediante permisos granulares', () => {
    expect(page).toContain("requirePagePermission('support.view')");
    expect(action).toContain("requirePermission('support.manage')");
    expect(nav).toContain("'support.view'");
    expect(ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN]).toContain('support.view');
    expect(ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN]).toContain('support.manage');
    expect(ROLE_PERMISSIONS[ROLE_KEYS.SUPERVISOR]).not.toContain('support.view');
    expect(ROLE_PERMISSIONS[ROLE_KEYS.MANAGEMENT]).not.toContain('support.view');
  });

  it('crea tabla e instala permisos para el Administrador de sistema', () => {
    expect(migration).toContain('CREATE TABLE "SupportRequest"');
    expect(migration).toContain("'support.view'");
    expect(migration).toContain("'support.manage'");
    expect(migration).toContain("r.\"key\" = 'ADMINISTRADOR_SISTEMA'");
  });
});
