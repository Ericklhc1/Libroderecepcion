import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@/lib/permissions';

describe('bandeja interna de soporte', () => {
  const route = readFileSync('src/app/api/soporte/solicitud/route.ts', 'utf8');
  const page = readFileSync('src/app/(app)/admin/soporte/page.tsx', 'utf8');
  const action = readFileSync('src/server/actions/support.ts', 'utf8');
  const nav = readFileSync('src/components/layout/nav-items.ts', 'utf8');
  const panel = readFileSync('src/components/layout/support-request-panel.tsx', 'utf8');
  const storage = readFileSync('src/server/storage/r2.ts', 'utf8');
  const attachmentInit = readFileSync(
    'src/app/api/soporte/adjuntos/init/route.ts',
    'utf8',
  );
  const attachmentOpen = readFileSync(
    'src/app/api/soporte/adjuntos/[attachmentId]/route.ts',
    'utf8',
  );
  const reset = readFileSync('src/server/services/factory-reset.ts', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260929183500_support_inbox/migration.sql',
    'utf8',
  );
  const attachmentMigration = readFileSync(
    'prisma/migrations/20260929185000_support_request_attachments/migration.sql',
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

  it('archiva adjuntos sin convertir R2 en dependencia del reporte', () => {
    expect(attachmentMigration).toContain('CREATE TABLE "SupportRequestAttachment"');
    expect(attachmentMigration).toContain('ON DELETE CASCADE');
    expect(attachmentInit).toContain('createR2PresignedPutUrl');
    expect(attachmentInit).toContain('isR2Configured');
    expect(attachmentInit).not.toContain('isR2Operational');
    expect(panel).toContain('/api/soporte/adjuntos/init');
    expect(panel).toContain('storedAttachments');
    expect(route).toContain('storedAttachments');
    expect(route).toContain('create: storedAttachments');
  });

  it('abre los adjuntos sólo tras comprobar permiso de soporte', () => {
    expect(page).toContain('/api/soporte/adjuntos/');
    expect(attachmentOpen).toContain("requirePermission('support.view')");
    expect(attachmentOpen).toContain('createR2PresignedGetUrl');
    expect(storage).toContain('export function createR2PresignedGetUrl');
  });

  it('la puesta en cero elimina soporte antes de intentar borrar cuentas', () => {
    expect(reset).toContain('tx.supportRequest.deleteMany()');
    expect(reset.indexOf('tx.supportRequest.deleteMany()')).toBeLessThan(
      reset.indexOf('tx.user.deleteMany'),
    );
  });
});
