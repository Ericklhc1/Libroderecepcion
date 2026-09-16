import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { getImportPreview, listImportBatches } from '@/server/services/pms-import';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { CONFLICT_LABELS, CONFLICT_TONE } from '@/domain/pms/conflicts';
import {
  COLUMN_LABELS,
  displayedSourceHeader,
  type ColumnField,
} from '@/domain/pms/columns';
import { STAY_STATUS_LABELS, STAY_STATUS_TONE } from '@/domain/rooms';
import { formatDate, formatDateTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';
import { ImportForm } from './import-form';
import { ReviewDecision } from './review';

export const metadata = { title: 'Importar informes del PMS' };
export const dynamic = 'force-dynamic';

/*
  Sembrar el catálogo o aplicar tres informes completos toma más que los diez
  segundos que la plataforma concede por omisión a una función.
*/
export const maxDuration = 60;

const REPORT_NAMES: Record<string, string> = {
  ACTIVIDAD: 'Habitaciones con actividad',
  ENTRADAS: 'Informe de entradas',
  IN_HOUSE: 'Informe in house',
  SALIDAS: 'Informe de salidas',
};

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('pms.import');
  const params = await searchParams;
  const batchId = typeof params.revision === 'string' ? params.revision : undefined;
  /*
    Destino de vuelta. Sólo se acepta una de las dos claves conocidas; el
    servidor la vuelve a validar antes de redirigir.
  */
  const returnTo =
    params.volverA === 'turno' || params.volverA === 'habitaciones'
      ? params.volverA
      : undefined;

  const [preview, batches] = await Promise.all([
    batchId ? getImportPreview(batchId).catch(() => null) : Promise.resolve(null),
    listImportBatches(8),
  ]);

  return (
    <div className="space-y-5">
      <div className="no-print">
        <Link
          href={returnTo === 'turno' ? '/turno' : '/habitaciones'}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {returnTo === 'turno' ? 'Mi turno' : 'Habitaciones'}
        </Link>
      </div>

      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Importar informes del PMS</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          El sistema reconoce el tipo de informe y sus columnas por los encabezados, no por su
          posición. Nada se aplica hasta que revises la propuesta.
        </p>
      </header>

      {!preview ? (
        <>
          <Card className="p-4">
            <ImportForm returnTo={returnTo} />
          </Card>

          <Card>
            <CardHeader title="Importaciones recientes" count={batches.length} />
            {batches.length ? (
              <ul className="divide-y divide-slate-100">
                {batches.map((batch) => (
                  <li key={batch.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="tabular font-medium text-petrol-900">
                      {formatDate(batch.businessDate)}
                    </span>
                    <Badge
                      tone={
                        batch.status === 'APLICADO'
                          ? 'resuelto'
                          : batch.status === 'DESCARTADO'
                            ? 'neutro'
                            : 'pendiente'
                      }
                    >
                      {batch.status === 'APLICADO'
                        ? 'Aplicado'
                        : batch.status === 'DESCARTADO'
                          ? 'Descartado'
                          : 'Borrador'}
                    </Badge>
                    <span className="text-slate-500">{batch.createdBy.name}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(batch.createdAt)}</span>
                    {batch.status === 'BORRADOR' ? (
                      <Link
                        href={`/habitaciones/importar?revision=${batch.id}`}
                        className="ml-auto text-sm font-medium text-petrol-600 hover:underline"
                      >
                        Revisar
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="Todavía no se ha importado ningún informe." />
            )}
          </Card>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Entradas" value={preview.counts.checkIn} />
            <StatTile label="In house" value={preview.counts.inHouse} />
            <StatTile label="Salidas" value={preview.counts.checkOut} />
            <StatTile
              label="Conflictos"
              value={preview.conflicts.length}
              tone={preview.conflicts.length ? 'alert' : 'good'}
            />
          </div>

          <Card>
            <CardHeader title="Qué entendió de cada informe" count={preview.reports.length} />
            <ul className="divide-y divide-slate-100">
              {preview.reports.map((report) => (
                <li key={report.fileName} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-petrol-900">{report.fileName}</span>
                    {report.kind ? (
                      <Badge tone="curso">{REPORT_NAMES[report.kind] ?? report.kind}</Badge>
                    ) : (
                      <Badge tone="critico">Sin identificar</Badge>
                    )}
                    {report.kindSource ? (
                      <span className="text-xs text-slate-500">
                        reconocido por {report.kindSource}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-slate-500">
                      <span className="tabular font-medium">{report.rowsRead}</span> fila(s)
                    </span>
                  </div>

                  {report.error ? (
                    <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-sm text-red-800 ring-1 ring-red-200">
                      {report.error}
                    </p>
                  ) : null}

                  {report.columns.length ? (
                    <>
                      <p className="mt-2 text-xs text-slate-500">
                        Encabezados del PDF. El campo interno se muestra aparte para no confundir lo
                        que FNS imprime con el nombre que usa el Libro.
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {report.columns.map((column) => {
                          const field = column.field as ColumnField;
                          const sourceHeader = displayedSourceHeader(
                            report.kind,
                            field,
                            column.header,
                          );
                          return (
                            <span
                              key={`${report.fileName}-${column.header}`}
                              className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                            >
                              <span className="font-medium">PDF: {sourceHeader}</span>
                              <span className="text-slate-400"> · campo interno: </span>
                              {COLUMN_LABELS[field] ?? column.field}
                            </span>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

                  {report.unmapped.length ? (
                    <p className="mt-2 text-xs text-orange-700">
                      Columnas sin reconocer: {report.unmapped.join(', ')}. Sus datos no se importan.
                    </p>
                  ) : null}

                  {report.declaredTotals.length ? (
                    <p className="mt-1 text-xs text-slate-500">
                      El informe declara:{' '}
                      {report.declaredTotals
                        .map((total) => `${total.label} ${total.numbers.join(' / ')}`)
                        .join(' · ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          {preview.conflicts.length ? (
            <Card>
              <CardHeader title="Conflictos que quedarían" count={preview.conflicts.length} />
              <ul className="divide-y divide-slate-100">
                {preview.conflicts.map((conflict, index) => (
                  <li key={`${conflict.kind}-${index}`} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={CONFLICT_TONE[conflict.kind]}>
                        {CONFLICT_LABELS[conflict.kind]}
                      </Badge>
                      {conflict.roomNumber ? (
                        <span className="text-sm font-medium tabular text-petrol-800">
                          Hab. {conflict.roomNumber}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{conflict.detail}</p>
                  </li>
                ))}
              </ul>
              <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                Son advertencias, no bloqueos: revísalas y decide. Una entrada en cola es lo normal
                cuando la habitación aún no se ha liberado.
              </p>
            </Card>
          ) : null}

          {preview.protectedStays.length ? (
            <Card>
              <CardHeader
                title="Se conservará lo que ya decidió una persona"
                count={preview.protectedStays.length}
              />
              <ul className="divide-y divide-slate-100">
                {preview.protectedStays.map((stay, index) => (
                  <li key={`${stay.reservationId}-${index}`} className="px-4 py-2 text-sm">
                    <span className="font-medium tabular text-petrol-900">Hab. {stay.roomNumber}</span>
                    <span className="ml-2 tabular text-slate-400">{stay.reservationId}</span>
                    <span className="ml-2 text-slate-600">{stay.reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {preview.orphans.length ? (
            <Card>
              <CardHeader title="Filas que no se pueden aplicar" count={preview.orphans.length} />
              <ul className="divide-y divide-slate-100">
                {preview.orphans.map((orphan, index) => (
                  <li key={`${orphan.reservationId}-${index}`} className="px-4 py-2 text-sm">
                    <span className="tabular font-medium text-petrol-900">{orphan.reservationId}</span>
                    <span className="ml-2 text-slate-700">{orphan.guestNames[0] ?? 'sin nombre'}</span>
                    <span className="ml-2 text-slate-500">{orphan.reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Filas leídas" count={preview.stays.length} />
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left">
                  <tr className="text-xs font-medium text-slate-500">
                    <th className="px-4 py-2">Hab.</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2">Reserva</th>
                    <th className="px-4 py-2">Huésped(es)</th>
                    <th className="px-4 py-2">Canal</th>
                    <th className="px-4 py-2">Llegada</th>
                    <th className="px-4 py-2">Salida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.stays.map((stay, index) => (
                    <tr key={`${stay.reservationId}-${stay.status}-${index}`}>
                      <td className="px-4 py-1.5 tabular font-medium text-petrol-900">
                        {stay.roomNumber ?? '—'}
                      </td>
                      <td className="px-4 py-1.5">
                        <Badge tone={STAY_STATUS_TONE[stay.status]}>
                          {STAY_STATUS_LABELS[stay.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-1.5 tabular text-slate-600">{stay.reservationId}</td>
                      <td className="px-4 py-1.5 text-slate-700">{stay.guestNames.join(' · ')}</td>
                      <td className="px-4 py-1.5 text-slate-500">{stay.channel ?? '—'}</td>
                      <td className="px-4 py-1.5 tabular text-slate-500">
                        {stay.arrivalDate ? formatDate(new Date(stay.arrivalDate)) : '—'}
                      </td>
                      <td className="px-4 py-1.5 tabular text-slate-500">
                        {stay.departureDate ? formatDate(new Date(stay.departureDate)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <ReviewDecision batchId={preview.batchId} returnTo={returnTo} />
        </>
      )}
    </div>
  );
}