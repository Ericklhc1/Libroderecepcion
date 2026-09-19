import Link from 'next/link';
import { ArrowLeft, Download, Mail, ShieldCheck } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { buildSupervisorReport, reportDateRange, type SupervisorReportType } from '@/server/services/supervisor-reports';
import { Card, CardHeader, CardScroll } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { sendSupervisorReportAction } from '@/server/actions/supervisor-reports';

export const metadata = { title: 'Informes de Supervisión' };
export const dynamic = 'force-dynamic';

const TYPES: SupervisorReportType[] = ['estado', 'gimnasio', 'multas'];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function key(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export default async function SupervisorReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePagePermission('supervision.view');
  const params = await searchParams;
  const q = one(params.q).trim().toLowerCase();
  const tipo = one(params.reporte);
  const range = reportDateRange(one(params.desde), one(params.hasta));
  const from = key(range.from);
  const to = key(range.to);
  const reports = await Promise.all(TYPES.map((type) => buildSupervisorReport(type, range)));
  const visibleReports = reports.filter((report) => {
    const typeMatches = !tipo || report.type === tipo;
    const text = [report.title, report.type, ...report.summary].join(' ').toLowerCase();
    return typeMatches && (!q || text.includes(q));
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/supervision" className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-600 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Supervisión
      </Link>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900"><ShieldCheck className="h-5 w-5 text-petrol-600" />Informes de Supervisión</h1>
        <p className="mt-1 text-sm text-slate-600">Estado operativo, pases de gimnasio y multas. El mismo PDF que descargas es el que se adjunta al correo.</p>
      </header>

      <form method="get" className="card flex flex-wrap items-end gap-3 p-3">
        <label><span className="label-base">Desde</span><input className="input-base" type="date" name="desde" defaultValue={from} /></label>
        <label><span className="label-base">Hasta</span><input className="input-base" type="date" name="hasta" defaultValue={to} /></label>
        <button type="submit" className="rounded-lg bg-petrol-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-petrol-800">Actualizar período</button>
      </form>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar informe o contenido…"
        clearHref={`/supervision/informes?desde=${from}&hasta=${to}`}
      >
        <input type="hidden" name="desde" value={from} />
        <input type="hidden" name="hasta" value={to} />
        <label className="min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Informe</span>
          <select name="reporte" defaultValue={tipo} className="input-base w-full">
            <option value="">Todos</option>
            <option value="estado">Estado operativo</option>
            <option value="gimnasio">Gimnasio</option>
            <option value="multas">Multas</option>
          </select>
        </label>
      </ListFilterBar>

      <div className="grid gap-4 lg:grid-cols-3">
        {visibleReports.map((report) => {
          const query = new URLSearchParams({ tipo: report.type, desde: from, hasta: to }).toString();
          return (
            <Card key={report.type} className="overflow-hidden">
              <CardHeader title={report.title} count={report.total} />
              <CardScroll maxHeight="max-h-[30rem]">
                <div className="space-y-3 p-4">
                <ul className="space-y-1 text-sm text-slate-600">
                  {report.summary.map((line) => <li key={line}>• {line}</li>)}
                </ul>
                <Link href={`/api/supervision/reportes?${query}`} className="inline-flex items-center gap-2 rounded-lg bg-petrol-700 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-800">
                  <Download className="h-4 w-4" aria-hidden="true" /> Descargar PDF
                </Link>
                <details className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                  <summary className="cursor-pointer text-sm font-medium text-petrol-700">Enviar por correo</summary>
                  <ActionForm action={sendSupervisorReportAction} className="mt-3 space-y-3">
                    <input type="hidden" name="type" value={report.type} />
                    <input type="hidden" name="from" value={from} />
                    <input type="hidden" name="toDate" value={to} />
                    <Field label="Destinatarios" name="recipients" required hint="Uno o varios correos separados por coma o punto y coma.">
                      <Input name="recipients" type="text" required placeholder="recepcion@hotel.cl; gerencia@hotel.cl" />
                    </Field>
                    <SubmitButton pendingLabel="Enviando PDF…"><Mail className="h-4 w-4" />Enviar PDF</SubmitButton>
                  </ActionForm>
                </details>
                </div>
              </CardScroll>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
