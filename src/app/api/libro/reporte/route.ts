import { withMaintenance } from '@/server/api/maintenance';
import type {CurrentUser} from '@/server/auth/current-user';
import type { NextRequest } from 'next/server';
import { isHkFocused } from '@/domain/housekeeping-work';
import { requireUser } from '@/server/auth/guard';
import { isReceptionDeskRole } from '@/lib/permissions';
import { formatDateTime } from '@/lib/format';
import { getBookReportItems, type BookFilters, type BookItem } from '@/server/services/book';
import { parseBookFilters, type RawSearchParams } from '@/lib/search-params';
import { createTextPdf } from '@/server/reports/simple-pdf';
import { AppError } from '@/server/errors';
import { createClosureBackup } from '@/server/services/system-closure';

export const dynamic = 'force-dynamic';

function reportLine(item: BookItem): string {
  const context = [
    item.priorityLabel ? `Prioridad: ${item.priorityLabel}` : null,
    item.departmentName ? `Área: ${item.departmentName}` : null,
    item.ownerName ? `Responsable: ${item.ownerName}` : null,
    item.creatorName ? `Registró: ${item.creatorName}` : null,
    item.shiftLabel ? `Turno: ${item.shiftLabel}` : null,
  ].filter(Boolean).join(' | ');

  return [
    formatDateTime(item.date),
    item.ref,
    item.typeLabel,
    item.statusLabel,
    context,
    item.title,
    item.summary,
  ].filter(Boolean).join(' | ');
}

async function collect(filters: BookFilters,user:CurrentUser): Promise<BookItem[]> {
  return getBookReportItems(filters, user);
}

function reportLines(item: BookItem): string[] {
  return [reportLine(item), ...(item.comments ?? []).map(comment =>
    `Comentario ${comment.id} | ${formatDateTime(comment.createdAt)} | ${comment.authorName}${comment.parentId ? ` | Respuesta a ${comment.parentId}` : ''} | ${comment.body}`,
  )];
}

/** Stream complete report bytes through the existing route without a buffered response limit. */
function reportStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

async function GETHandler(request: NextRequest) {
  const user = await requireUser();
  const url = new URL(request.url);
  if (url.searchParams.get('respaldo') === 'cierre') {
    if (!user.isSystemAdmin) return Response.json({ error: 'Sólo el Administrador de sistema puede descargar el respaldo de cierre.' }, { status: 403 });
    let backup: Awaited<ReturnType<typeof createClosureBackup>>;
    try { backup = await createClosureBackup(user); }
    catch (error) {
      if (error instanceof AppError) return Response.json({ error: error.message, code: error.code }, { status: error.code === 'FORBIDDEN' ? 403 : 409, headers: { 'Cache-Control': 'no-store' } });
      throw error;
    }
    return new Response(reportStream(new TextEncoder().encode(backup.body)), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${backup.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-SHA256': backup.digest,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (isHkFocused(user)) return Response.json({error:'Tu cuenta no tiene acceso al informe general de Recepción.'},{status:403});
  const raw = Object.fromEntries(url.searchParams.entries()) as RawSearchParams;
  const view = url.searchParams.get('vista') === 'novedades' ? 'novedades' : 'historial';
  const receptionDesk = isReceptionDeskRole(user.roleKey);

  const parsed = parseBookFilters(raw, { pageSize: 100 });
  const filters: BookFilters =
    view === 'novedades'
      ? {
          ...parsed,
          kinds: ['entry'],
          receptionEntriesOnly: true,
          onlyOpen: true,
          hideClosureValidation: receptionDesk,
          page: 1,
          pageSize: 100,
        }
      : {
          ...parsed,
          hideClosureValidation: receptionDesk,
          page: 1,
          pageSize: 100,
        };

  const rows = await collect(filters,user);
  const title = view === 'novedades' ? 'Informe de novedades en gestión' : 'Informe del historial operativo';
  const from = url.searchParams.get('desde');
  const to = url.searchParams.get('hasta');
  const subtitle = from || to
    ? `Período: ${from || 'inicio'} a ${to || 'hoy'} · Registros: ${rows.length}`
    : `Registros: ${rows.length}`;

  const pdf = createTextPdf({
    title,
    subtitle,
    lines: rows.length > 0 ? rows.flatMap(reportLines) : ['Sin registros para los filtros seleccionados.'],
  });

  const filename = `${view === 'novedades' ? 'novedades' : 'historial-operativo'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  const disposition = url.searchParams.get('descargar') === '1' ? 'attachment' : 'inline';

  return new Response(reportStream(new Uint8Array(pdf)), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = withMaintenance(GETHandler);
