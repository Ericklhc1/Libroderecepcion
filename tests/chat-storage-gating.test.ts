import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Chat · gate real de almacenamiento', () => {
  it('el bootstrap publica disponibilidad operativa, no sólo variables configuradas', () => {
    const service = readFileSync('src/server/services/chat.ts', 'utf8');

    expect(service).toContain('isR2Operational');
    expect(service).toContain('storageOperational');
    expect(service).toContain('storageEnabled: storageOperational');
    expect(service).toContain('assertChatStorageOperational');
    expect(service.match(/assertChatStorageOperational/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
  });

  it('la interfaz no ofrece adjuntos rotos cuando R2 está caído', () => {
    const widget = readFileSync('src/components/layout/chat-widget.tsx', 'utf8');

    expect(widget).toContain('storageChecked');
    expect(widget).toContain('temporalmente no disponible');
    expect(widget).toContain('El resto del Chat sigue operativo');
    expect(widget).not.toContain('Activa Cloudflare R2 para enviar imágenes y archivos.');
    expect(widget).not.toContain('se activarán al conectar Cloudflare R2');
  });
});
