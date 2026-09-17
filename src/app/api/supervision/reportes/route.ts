import { NextRequest } from 'next/server';
import { requirePermission } from '@/server/auth/guard';
import { buildSupervisorReport, reportDateRange, type SupervisorReportType } from '@/server/services/supervisor-reports';
import { createTextPdf } from '@/server/reports/simple-pdf';

export const dynamic = 'force-dynamic';

const TYPES = new Set<SupervisorReportType>(['gimnasio', 'multas', 'estado']);

export async function GET(request: NextRequest) {
  await requirePermission('supervision.view');
  const url = new URL(request.url);
  const rawType = url.searchParams.get('tipo') as SupervisorReportType | null;
  if (!rawType || !TYPES.has(rawType)) {
    return new Response('Tipo de informe no válido.', { status: 400 });
  }
  const range = reportDateRange(url.searchParams.get('desde'), url.searchParams.get('hasta'));
  const report = await buildSupervisorReport(rawType, range);
  const pdf = createTextPdf({
    title: report.title,
    subtitle: `${range.from.toLocaleDateString('es-CL')} a ${range.to.toLocaleDateString('es-CL')}`,
    lines: [...report.summary, '', ...report.lines],
  });
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${report.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
