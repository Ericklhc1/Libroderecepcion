import type { NextRequest } from 'next/server';
import { requirePermission } from '@/server/auth/guard';
import { calendarDateKey } from '@/domain/time';
import { listGymPasses } from '@/server/services/gym-pass';

export const dynamic = 'force-dynamic';

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

export async function GET(request: NextRequest) {
  await requirePermission('cash.view');

  const url = new URL(request.url);
  const from = url.searchParams.get('desde');
  const to = url.searchParams.get('hasta');

  const summary = await listGymPasses({
    from: from || null,
    to: to || null,
    limit: 1000,
  });

  const lines = [
    [
      'Folio',
      'Fecha',
      'Habitación',
      'Huésped',
      'Recepcionista',
      'Estado',
      'Emitido en',
      'Motivo de anulación',
    ].map(csvCell).join(','),
    ...summary.rows.map((row) =>
      [
        row.formattedFolio,
        calendarDateKey(row.serviceDate),
        row.roomNumber,
        row.guestName,
        row.receptionistName,
        row.status,
        row.issuedAt.toISOString(),
        row.voidReason,
      ].map(csvCell).join(','),
    ),
  ];

  const filename =
    'folios-gimnasio-' +
    (from || 'inicio') +
    '-a-' +
    (to || 'hoy') +
    '.csv';

  return new Response('\uFEFF' + lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Cache-Control': 'no-store',
    },
  });
}
