import Link from 'next/link';
import { CheckCircle2, ClipboardList, FileUp, TriangleAlert } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatDateTime } from '@/lib/format';
import { getShiftReportsState } from '@/server/services/pms-import';
import { GuestReservationImportForm } from '@/app/(app)/huespedes/import-form';

export async function ReservationReports({ canImport }: { canImport: boolean }) {
  const { applied, draft, today } = await getShiftReportsState();

  if (draft) {
    return (
      <Card className="border-amber-300">
        <CardHeader title="Datos de huéspedes & reservas" />
        <div className="space-y-3 px-4 py-4">
          <p className="flex items-start gap-2 text-sm text-petrol-900">
            <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              La carga del <span className="tabular">{formatDate(draft.businessDate)}</span> ya fue leída y espera revisión. La inició {draft.createdByName} el {formatDateTime(draft.createdAt)}.
            </span>
          </p>
          <p className="text-xs text-slate-600">
            Al aplicarla se actualizan las reservas, huéspedes, estadías y el contexto que consumen habitaciones, llaves, caja, garantías y los demás módulos conectados.
          </p>
          {canImport ? (
            <Link
              href={`/huespedes/importar?revision=${draft.id}`}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gold-500 px-5 py-2.5 text-base font-semibold text-petrol-950 transition-colors hover:bg-gold-400 active:bg-gold-600"
            >
              Revisar y aplicar
            </Link>
          ) : null}
        </div>
      </Card>
    );
  }

  const coveredToday = applied?.isToday ?? false;

  return (
    <Card className={coveredToday ? undefined : 'border-amber-300'}>
      <CardHeader
        title="Datos de huéspedes & reservas"
        action={<Badge tone={coveredToday ? 'resuelto' : 'pendiente'}>{coveredToday ? 'Actualizados' : 'Pendientes'}</Badge>}
      />
      <div className="space-y-3 px-4 py-4">
        {coveredToday && applied ? (
          <>
            <p className="flex items-start gap-2 text-sm text-petrol-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>
                La información del día está incorporada{applied.appliedByName ? ` por ${applied.appliedByName}` : ''}{applied.appliedAt ? `, el ${formatDateTime(applied.appliedAt)}` : ''}.
              </span>
            </p>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {[
                ['Entradas', applied.counts.checkIn],
                ['In house', applied.counts.inHouse],
                ['Salidas', applied.counts.checkOut],
              ].map(([label, value]) => (
                <div key={label as string} className="flex items-baseline gap-1.5">
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="tabular font-semibold text-petrol-900">{value}</dd>
                </div>
              ))}
            </dl>
            {canImport ? (
              <Link href="/huespedes/importar" className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-600 hover:underline">
                <FileUp className="h-4 w-4" aria-hidden="true" />
                Cargar información nueva
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <p className="flex items-start gap-2 text-sm text-petrol-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              <span>
                Todavía no se ha incorporado la información del <span className="tabular">{formatDate(today)}</span>. Cárgala aquí para alimentar reservas, huéspedes y los módulos conectados.
              </span>
            </p>
            {applied ? (
              <p className="text-xs text-slate-600">La última carga aplicada corresponde al {formatDate(applied.businessDate)}.</p>
            ) : null}
            {canImport ? <GuestReservationImportForm /> : null}
          </>
        )}
      </div>
    </Card>
  );
}
