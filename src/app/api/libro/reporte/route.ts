import { withMaintenance } from '@/server/api/maintenance';
import type {CurrentUser} from '@/server/auth/current-user';
import type { NextRequest } from 'next/server';
import { isHkFocused } from '@/domain/housekeeping-work';
import { requireUser } from '@/server/auth/guard';
import { isReceptionDeskRole } from '@/lib/permissions';
import { formatDateTime } from '@/lib/format';
import { getBookItems, type BookFilters, type BookItem } from '@/server/services/book';
import { parseBookFilters, type RawSearchParams } from '@/lib/search-params';
import { createTextPdf } from '@/server/reports/simple-pdf';

export const dynamic = 'force-dynamic';

function compact(value: string | null | undefined, max = 220): string {
  if (!value) return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

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
    compact(item.summary),
  ].filter(Boolean).join(' | ');
}

async function collect(filters: BookFilters,user:CurrentUser): Promise<BookItem[]> {
  const rows: BookItem[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await getBookItems({ ...filters, page, pageSize: 100 },user);
    rows.push(...result.items);
    if (!result.hasMore) break;
  }
  return rows;
}

async function GETHandler(request: NextRequest) {
  const user = await requireUser();
  if (isHkFocused(user)) return Response.json({error:'Tu cuenta no tiene acceso al informe general de Recepción.'},{status:403});
  const url = new URL(request.url);
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
    lines: rows.length > 0 ? rows.map(reportLine) : ['Sin registros para los filtros seleccionados.'],
  });

  const filename = `${view === 'novedades' ? 'novedades' : 'historial-operativo'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  const disposition = url.searchParams.get('descargar') === '1' ? 'attachment' : 'inline';

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = withMaintenance(GETHandler);
