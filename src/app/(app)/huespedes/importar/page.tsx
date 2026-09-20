import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { getImportPreview, listImportBatches } from '@/server/services/pms-import';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { STAY_STATUS_LABELS, STAY_STATUS_TONE } from '@/domain/rooms';
import { formatDate, formatDateTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';
import { GuestReservationImportForm } from '../import-form';
import { GuestReservationReviewActions } from './review-actions';

export const metadata = { title: 'Cargar huéspedes & reservas' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function GuestReservationImportPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('pms.import');
  const params = await searchParams;
  const batchId = typeof params.revision === 'string' ? params.revision : undefined;
  const returnTo = params.volverA === 'turno' ? 'turno' as const : undefined;
  const backHref = returnTo === 'turno' ? '/turno' : '/huespedes';
  const backLabel = returnTo === 'turno' ? 'Mi turno' : 'Huéspedes & reservas';

  const [preview, batches] = await Promise.all([
    batchId ? getImportPreview(batchId).catch(() => null) : Promise.resolve(null),
    listImportBatches(8),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="no-print">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-600 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
      </div>

      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Cargar información de huéspedes & reservas</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Esta es la única ruta de importación PMS. Admite PDF, Excel, CSV y TSV de distintas plantillas; extrae los datos operativos por significado y nada se aplica sin revisión previa.
        </p>
      </header>

      {returnTo === 'turno' ? (
        <div className="rounded-lg bg-gold-50 px-4 py-3 text-sm text-petrol-900 ring-1 ring-gold-200">
          Estás actualizando la fotografía PMS para el cierre de turno. Después de aplicar volverás a Mi turno para continuar la entrega.
        </div>
      ) : null}

      {!preview ? (
        <>
          <Card className="p-4">
            <GuestReservationImportForm returnTo={returnTo} />
          </Card>
          <Card>
            <CardHeader title="Cargas recientes" count={batches.length} />
            {batches.length ? (
              <ul className="divide-y divide-slate-100">
                {batches.map((batch) => (
                  <li key={batch.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="tabular font-medium text-petrol-900">{formatDate(batch.businessDate)}</span>
                    <Badge tone={batch.status === 'APLICADO' ? 'resuelto' : batch.status === 'DESCARTADO' ? 'neutro' : 'pendiente'}>
                      {batch.status === 'APLICADO' ? 'Aplicado' : batch.status === 'DESCARTADO' ? 'Descartado' : 'Borrador'}
                    </Badge>
                    <span className="text-slate-500">{batch.createdBy.name}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(batch.createdAt)}</span>
                    {batch.status === 'BORRADOR' ? (
                      <Link
                        href={`/huespedes/importar?revision=${batch.id}${returnTo ? '&volverA=turno' : ''}`}
                        className="ml-auto text-sm font-medium text-petrol-600 hover:underline"
                      >
                        Revisar
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <EmptyState message="Todavía no hay cargas registradas." />}
          </Card>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Entradas" value={preview.counts.checkIn} />
            <StatTile label="In house" value={preview.counts.inHouse} />
            <StatTile label="Salidas" value={preview.counts.checkOut} />
            <StatTile label="Advertencias" value={preview.conflicts.length + preview.orphans.length + preview.activity.rowIssues.length} tone={preview.conflicts.length + preview.orphans.length + preview.activity.rowIssues.length ? 'alert' : 'good'} />
          </div>

          <Card>
            <CardHeader title="Archivos interpretados" count={preview.reports.length} />
            <ul className="divide-y divide-slate-100">
              {preview.reports.map((report, index) => (
                <li key={`${report.fileName}-${index}`} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-petrol-900">{report.fileName}</span>
                    <Badge tone={report.error ? 'atencion' : 'resuelto'}>
                      {report.error ? 'Revisar' : `${report.rowsRead} fila(s)`}
                    </Badge>
                  </div>
                  {report.error ? <p className="mt-1 text-red-700">{report.error}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">
                    Campos reconocidos: {report.columns.map((column) => column.header).join(' · ') || 'ninguno'}
                  </p>
                  {report.unmapped.length ? (
                    <p className="mt-1 text-xs text-orange-700">Sin usar: {report.unmapped.join(' · ')}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Resumen de la carga" count={preview.stays.length} />
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs text-slate-500">Habitaciones con actividad</p><p className="mt-1 font-semibold text-petrol-900">{preview.activity.roomsWithActivity}</p></div>
              <div><p className="text-xs text-slate-500">Reservas nuevas</p><p className="mt-1 font-semibold text-petrol-900">{preview.activity.newReservations}</p></div>
              <div><p className="text-xs text-slate-500">Con saldo pendiente</p><p className="mt-1 font-semibold text-petrol-900">{preview.activity.withBalance}</p></div>
              <div><p className="text-xs text-slate-500">Reservas multihabitación</p><p className="mt-1 font-semibold text-petrol-900">{preview.activity.multiRoom.length}</p></div>
            </div>
          </Card>

          {preview.conflicts.length || preview.orphans.length || preview.activity.rowIssues.length ? (
            <Card>
              <CardHeader title="Revisar antes de aplicar" count={preview.conflicts.length + preview.orphans.length + preview.activity.rowIssues.length} />
              <div className="space-y-2 px-4 py-3 text-sm text-slate-700">
                {preview.conflicts.map((conflict, index) => (
                  <p key={`${conflict.kind}-${index}`}>{conflict.roomNumber ? `Hab. ${conflict.roomNumber}: ` : ''}{conflict.detail}</p>
                ))}
                {preview.orphans.map((orphan, index) => (
                  <p key={`${orphan.reservationId}-${index}`}>Reserva {orphan.reservationId}: {orphan.reason}</p>
                ))}
                {preview.activity.rowIssues.map((issue, index) => (
                  <p key={`issue-${issue.reservationId}-${index}`}>
                    {issue.roomNumber ? `Hab. ${issue.roomNumber} · ` : ''}Reserva {issue.reservationId || 'sin ID'}: {issue.issues.join(' ')}
                  </p>
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Reservas y estadías detectadas" count={preview.stays.length} />
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr><th className="px-4 py-2">Hab.</th><th className="px-4 py-2">Estado</th><th className="px-4 py-2">Reserva</th><th className="px-4 py-2">Huésped(es)</th><th className="px-4 py-2">Llegada</th><th className="px-4 py-2">Salida</th><th className="px-4 py-2">Canal</th><th className="px-4 py-2">Total / pendiente</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.stays.map((stay, index) => (
                    <tr key={`${stay.reservationId}-${stay.status}-${index}`}>
                      <td className="px-4 py-1.5 tabular font-medium text-petrol-900">{stay.roomNumber ?? '—'}</td>
                      <td className="px-4 py-1.5">
                        {stay.status ? (
                          <Badge tone={STAY_STATUS_TONE[stay.status]}>{STAY_STATUS_LABELS[stay.status]}</Badge>
                        ) : (
                          <Badge tone="atencion">Sin determinar</Badge>
                        )}
                      </td>
                      <td className="px-4 py-1.5 tabular text-slate-600">{stay.reservationId}</td>
                      <td className="px-4 py-1.5 text-slate-700">{stay.guestNames.join(' · ') || '—'}</td>
                      <td className="px-4 py-1.5 whitespace-nowrap text-slate-600">{stay.arrivalDate ? formatDate(new Date(stay.arrivalDate)) : '—'}</td>
                      <td className="px-4 py-1.5 whitespace-nowrap text-slate-600">{stay.departureDate ? formatDate(new Date(stay.departureDate)) : '—'}</td>
                      <td className="px-4 py-1.5 text-slate-500">{stay.channel ?? '—'}</td>
                      <td className="px-4 py-1.5 tabular text-slate-600">
                        {stay.currency ?? ''} {stay.totalAmount ?? '—'} / {stay.pendingAmount ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <GuestReservationReviewActions batchId={preview.batchId} returnTo={returnTo} />
        </>
      )}
    </div>
  );
}
