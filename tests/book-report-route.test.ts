import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/libro/reporte/route';
import { RuleError } from '@/server/errors';
import type { BookItem } from '@/server/services/book';

const mocks = vi.hoisted(() => ({ user: vi.fn(), items: vi.fn(), backup: vi.fn() }));
vi.mock('@/server/auth/guard', () => ({ requireUser: mocks.user }));
vi.mock('@/server/api/maintenance', () => ({ withMaintenance: (handler: unknown) => handler }));
vi.mock('@/server/services/book', () => ({ getBookReportItems: mocks.items }));
vi.mock('@/server/services/system-closure', () => ({ createClosureBackup: mocks.backup }));

const request = (query = '') => new NextRequest(`https://example.invalid/api/libro/reporte${query}`);
describe('una ruta canónica de informes y respaldo del cierre', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ id: 'reader', roleKey: 'RECEPCIONISTA', permissions: [], isSystemAdmin: false });
    mocks.items.mockResolvedValue([]);
  });

  it('el respaldo completo exige sysadmin en el servidor', async () => {
    const response = await GET(request('?respaldo=cierre'));
    expect(response.status).toBe(403);
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  it('entrega exactamente los bytes y la huella generados, sin marcar una verificación', async () => {
    mocks.user.mockResolvedValue({ id: 'admin', isSystemAdmin: true });
    mocks.backup.mockResolvedValue({ body: '{"respaldo":"íntegro"}\n', digest: 'a'.repeat(64), filename: 'cierre-ficticio.json' });
    const response = await GET(request('?respaldo=cierre'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"respaldo":"íntegro"}\n');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="cierre-ficticio.json"');
    expect(response.headers.get('X-Content-SHA256')).toBe('a'.repeat(64));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.backup).toHaveBeenCalledExactlyOnceWith({ id: 'admin', isSystemAdmin: true });
    expect(mocks.items).not.toHaveBeenCalled();
  });

  it('transmite más de 4,5 MB sin alterar bytes UTF-8 ni la huella', async () => {
    mocks.user.mockResolvedValue({ id: 'admin', isSystemAdmin: true });
    const body = JSON.stringify({ texto: 'Texto íntegro ñ 🌿\n'.repeat(350_000), final: 'FINAL_ARCHIVO_VISIBLE' }) + '\n';
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(4.5 * 1024 * 1024);
    mocks.backup.mockResolvedValue({ body, digest, filename: 'cierre-grande-ficticio.json' });
    const response = await GET(request('?respaldo=cierre'));
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.has('Content-Length')).toBe(false);
    const received = await response.text();
    expect(received).toBe(body);
    expect(createHash('sha256').update(received, 'utf8').digest('hex')).toBe(response.headers.get('X-Content-SHA256'));
    expect(received).toContain('FINAL_ARCHIVO_VISIBLE');
  });

  it('explica las precondiciones incumplidas sin aparentar una descarga válida', async () => {
    mocks.user.mockResolvedValue({ id: 'admin', isSystemAdmin: true });
    mocks.backup.mockRejectedValue(new RuleError('Hay un turno sin finalizar.'));
    const response = await GET(request('?respaldo=cierre'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'Hay un turno sin finalizar.' });
    expect(response.headers.has('Content-Disposition')).toBe(false);
  });

  it('el PDF contiene registros después de 2000, descripción y comentarios completos', async () => {
    const text = `${'detalle completo '.repeat(30)}FINAL_DESCRIPCION_VISIBLE`;
    mocks.items.mockResolvedValue(Array.from({ length: 2005 }, (_, index): BookItem => ({
      kind: 'entry', id: `row-${index}`, ref: `#${index + 1}`, kindLabel: 'Novedad', typeLabel: 'Novedad', title: `Registro ${index + 1}`,
      summary: text, statusLabel: 'Abierto', tone: 'neutro', priorityLabel: null, priorityTone: null,
      departmentName: null, ownerName: null, creatorName: 'Autor ficticio', date: new Date('2026-10-15T12:00:00Z'), shiftLabel: null,
      dueAt: null, overdue: false, hasFollowUp: false, commentCount: 1, guestLabel: null, href: '/libro', deleted: false,
      comments: [{ id: `comment-${index}`, body: `${text} FINAL_COMENTARIO_VISIBLE`, authorId: 'author', authorName: 'Autor ficticio', createdAt: new Date('2026-10-15T12:01:00Z'), parentId: null }],
    })));
    const response = await GET(request('?descargar=1'));
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers.has('Content-Length')).toBe(false);
    const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(pdf).toContain('#2005');
    expect(pdf).toContain('Registros: 2005');
    expect(pdf).toContain('FINAL_DESCRIPCION_VISIBLE');
    expect(pdf).toContain('FINAL_COMENTARIO_VISIBLE');
  });
});
