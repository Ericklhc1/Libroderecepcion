import Link from 'next/link';
import { CheckCircle2, ClipboardList, FileUp, TriangleAlert } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatDateTime } from '@/lib/format';
import type { ShiftReportsState } from '@/server/services/pms-import';
import { ImportForm } from '@/app/(app)/habitaciones/importar/import-form';

/**
 * Los tres informes del PMS como paso del inicio de turno.
 *
 * Es el primer gesto del turno: se cargan entradas, in house y salidas, y de
 * ahí el sistema deriva el estado de las 89 habitaciones y de las llaves. No
 * bloquea el inicio del turno —si el PMS no responde, la recepción tiene que
 * poder operar igual— pero sí deja visible que falta.
 *
 * Se conserva la pantalla de revisión: nada sobrescribe lo que una persona ya
 * decidió sin que alguien vea antes qué va a cambiar.
 */
export function ShiftReports({
  state,
  canImport,
}: {
  state: ShiftReportsState;
  canImport: boolean;
}) {
  const { applied, draft, today } = state;

  // Un borrador leído y sin revisar es lo más urgente: ya se hizo el trabajo
  // de leer los PDF y falta un clic para que sirva de algo.
  if (draft) {
    return (
      <Card className="border-amber-300">
        <CardHeader title="Informes del PMS" />
        <div className="space-y-3 px-4 py-4">
          <p className="flex items-start gap-2 text-sm text-petrol-900">
            <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              Los informes del <span className="tabular">{formatDate(draft.businessDate)}</span>{' '}
              ya están leídos y esperan revisión. Los cargó {draft.createdByName} el{' '}
              {formatDateTime(draft.createdAt)}.
            </span>
          </p>
          <p className="text-xs text-slate-600">
            Hasta que se apliquen, el estado de las habitaciones y de las llaves sigue como
            estaba.
          </p>
          {canImport ? (
            <Link
              href={`/habitaciones/importar?revision=${draft.id}&volverA=turno`}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gold-500 px-5 py-2.5 text-base font-semibold text-petrol-950 transition-colors hover:bg-gold-400 active:bg-gold-600"
            >
              Revisar y aplicar
            </Link>
          ) : (
            <p className="text-xs text-slate-500">
              Tu rol no incluye el permiso para aplicar informes. Se concede en{' '}
              <Link href="/admin/roles" className="font-medium text-petrol-600 hover:underline">
                Administración → Roles
              </Link>
              .
            </p>
          )}
        </div>
      </Card>
    );
  }

  const coveredToday = applied?.isToday ?? false;

  return (
    <Card className={coveredToday ? undefined : 'border-amber-300'}>
      <CardHeader
        title="Informes del PMS"
        action={
          coveredToday ? (
            <Badge tone="resuelto">Cargados</Badge>
          ) : (
            <Badge tone="pendiente">Pendientes</Badge>
          )
        }
      />

      <div className="space-y-3 px-4 py-4">
        {coveredToday && applied ? (
          <>
            <p className="flex items-start gap-2 text-sm text-petrol-900">
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              <span>
                Los informes del día están aplicados
                {applied.appliedByName ? ` por ${applied.appliedByName}` : ''}
                {applied.appliedAt ? `, el ${formatDateTime(applied.appliedAt)}` : ''}.
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
            <p className="text-xs text-slate-600">
              Si el PMS emitió informes nuevos durante el turno, vuelve a cargarlos: se comparan
              con lo que hay y sólo cambia lo que cambió.
            </p>
          </>
        ) : (
          <>
            <p className="flex items-start gap-2 text-sm text-petrol-900">
              <TriangleAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <span>
                Todavía no se han cargado los informes del{' '}
                <span className="tabular">{formatDate(today)}</span>. Cárgalos para que el
                tablero de habitaciones, la regla de cola y el inventario de llaves reflejen el
                día.
              </span>
            </p>
            {applied ? (
              <p className="text-xs text-slate-600">
                El último informe aplicado es del{' '}
                <span className="tabular">{formatDate(applied.businessDate)}</span>: lo que
                muestran las habitaciones corresponde a ese día.
              </p>
            ) : null}
          </>
        )}

        {canImport && !coveredToday ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-3">
            <ImportForm returnTo="turno" />
          </div>
        ) : null}

        {canImport && coveredToday ? (
          <Link
            href="/habitaciones/importar?volverA=turno"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-600 hover:underline"
          >
            <FileUp className="h-4 w-4" aria-hidden="true" />
            Cargar informes nuevos
          </Link>
        ) : null}

        {!canImport && !coveredToday ? (
          <p className="text-xs text-slate-500">
            Tu rol no incluye el permiso «Importar informes del PMS», así que aquí no aparece
            el campo para adjuntarlos. Se concede en{' '}
            <Link href="/admin/roles" className="font-medium text-petrol-600 hover:underline">
              Administración → Roles
            </Link>
            .
          </p>
        ) : null}
      </div>
    </Card>
  );
}
