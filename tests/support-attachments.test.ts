import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('adjuntos persistentes de soporte', () => {
  const panel = readFileSync('src/components/layout/support-request-panel.tsx', 'utf8');
  const initRoute = readFileSync('src/app/api/soporte/adjuntos/init/route.ts', 'utf8');
  const downloadRoute = readFileSync(
    'src/app/api/soporte/adjuntos/[attachmentId]/route.ts',
    'utf8',
  );
  const requestRoute = readFileSync('src/app/api/soporte/solicitud/route.ts', 'utf8');
  const page = readFileSync('src/app/(app)/admin/soporte/page.tsx', 'utf8');
  const storage = readFileSync('src/server/storage/r2.ts', 'utf8');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const migration = readFileSync(
    'prisma/migrations/20260929185000_support_request_attachments/migration.sql',
    'utf8',
  );

  it('sube el binario directo al almacenamiento y evita reenviar base64 cuando ya quedó archivado', () => {
    expect(panel).toContain("archiveAttachment(item.draft, item.kind)");
    expect(panel).toContain("storedKinds.has('CAPTURA') ? null : screenshot");
    expect(panel).toContain("storedKinds.has('ARCHIVO') ? null : attachment");
    expect(panel).toContain("method: 'PUT'");
    expect(initRoute).toContain('createR2PresignedPutUrl');
    expect(initRoute).toContain('isR2Configured');
    expect(initRoute).not.toContain('isR2Operational');
  });

  it('persiste metadatos en Neon y conserva el inventario total de adjuntos', () => {
    expect(schema).toContain('model SupportRequestAttachment');
    expect(schema).toContain('attachments     SupportRequestAttachment[]');
    expect(requestRoute).toContain('storedAttachments');
    expect(requestRoute).toContain('attachmentNames: allAttachmentNames');
    expect(migration).toContain('CREATE TABLE "SupportRequestAttachment"');
    expect(migration).toContain('ON DELETE CASCADE');
  });

  it('abre archivos sólo tras comprobar permiso y usa URL GET temporal sin proxy binario', () => {
    expect(downloadRoute).toContain("requirePermission('support.view')");
    expect(downloadRoute).toContain('createR2PresignedGetUrl');
    expect(downloadRoute).not.toContain('getR2Object(');
    expect(storage).toContain('export function createR2PresignedGetUrl');
    expect(page).toContain('attachments: { orderBy:');
    expect(page).toContain('/api/soporte/adjuntos/');
    expect(page).toContain("item.kind === 'CAPTURA'");
  });

  it('mantiene el correo sólo como respaldo para adjuntos que no lograron archivarse', () => {
    expect(requestRoute).toContain('Disponibles en bandeja:');
    expect(requestRoute).toContain('Incluidos como respaldo en este correo:');
    expect(panel).toContain('el sistema conserva el envío por correo como respaldo');
  });
});
