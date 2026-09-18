import Link from 'next/link';
import { ArrowRight, Banknote, Dumbbell, PlusCircle, Scale, ShieldCheck } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import {
  formatGymFolio,
  getLiveCashStateWithGym as getLiveCashState,
} from '@/server/services/gym-pass';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import {
  LiveCashAuditForm,
  ManualCashMovementForm,
  VoidGymPassDialog,
} from '@/components/cash/live-cash-forms';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Caja' };
export const dynamic = 'force-dynamic';

const MOVEMENT_LABEL: Record<string, string> = {
  GARANTIA_INGRESO: 'Garantía recibida',
  GARANTIA_DEVOLUCION: 'Garantía devuelta',
  VENTA_GIMNASIO: 'Pase gimnasio histórico',
  ANULACION_GIMNASIO: 'Anulación gimnasio histórica',
  AJUSTE_ENTRADA: 'Ingreso manual',
  AJUSTE_SALIDA: 'Egreso manual',
};

function amount(currency: string, value: number) {
  return `${currency} ${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`;
}

function human(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

export default async function LiveCashPage() {
  const user = await requirePagePermission('room.view');
  const state = await getLiveCashState();
  const canOperate = hasPermission(user, 'room.manage');

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-petrol-900">Caja</h1>
          <p className="mt-1 text-sm text-slate-600">
            Saldo físico esperado, garantías en custodia, movimientos y corroboraciones. Los folios de
            gimnasio se muestran aquí como información y no modifican la caja.
          </p>
        </div>
        {canOperate ? (
          <div className="flex flex-wrap gap-2 no-print">
            <Dialog
              title="Registrar movimiento de caja"
              description="Registra un ingreso o egreso manual. El sistema exigirá que tengas un turno operativo abierto."
              triggerVariant="primary"
              triggerSize="sm"
              width="sm"
              trigger={
                <>
                  <PlusCircle className="h-4 w-4" aria-hidden="true" />
                  Ingreso / egreso
                </>
              }
            >
              <ManualCashMovementForm />
            </Dialog>
            <Link
              href="/habitaciones"
              className="inline-flex items-center gap-2 rounded-lg bg-petrol-800 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-700"
            >
              <Dumbbell className="h-4 w-4" aria-hidden="true" />
              Generar pase desde habitación
            </Link>
          </div>
        ) : null}
      </header>

      {state.currencies.length === 0 ? (
        <Card>
          <EmptyState message="No hay fondo fijo ni movimientos de caja registrados todavía." />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {state.currencies.map((item) => (
            <Card key={item.currency}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Caja física {item.currency}
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular text-petrol-900">
                      {amount(item.currency, item.expected)}
                    </p>
                  </div>
                  <Banknote className="h-5 w-5 text-petrol-600" aria-hidden="true" />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <dt className="text-slate-500">Fondo fijo</dt>
                    <dd className="mt-0.5 font-semibold tabular text-petrol-900">
                      {amount(item.currency, item.fund)}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <dt className="text-slate-500">Movimientos netos</dt>
                    <dd className="mt-0.5 font-semibold tabular text-petrol-900">
                      {item.netMovements > 0 ? '+' : ''}{amount(item.currency, item.netMovements)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 no-print">
                  <Dialog
                    title={`Corroborar caja ${item.currency}`}
                    description={`El sistema espera ${amount(item.currency, item.expected)}. Cuenta lo que existe físicamente ahora.`}
                    triggerVariant="secondary"
                    triggerSize="sm"
                    width="sm"
                    trigger={
                      <>
                        <Scale className="h-4 w-4" aria-hidden="true" />
                        Corroborar ahora
                      </>
                    }
                  >
                    <LiveCashAuditForm currency={item.currency} />
                  </Dialog>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Garantías en efectivo bajo custodia" count={state.cashGuarantees.length} />
          {state.cashGuarantees.length === 0 ? (
            <EmptyState message="No hay garantías en efectivo activas." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {state.cashGuarantees.map((guarantee) => (
                <li key={guarantee.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-petrol-900">
                        {guarantee.guestName ?? 'Huésped sin nombre'}
                        {guarantee.roomNumber ? ` · Hab. ${guarantee.roomNumber}` : ''}
                      </p>
                      <p className="text-xs tabular text-slate-500">
                        Reserva {guarantee.reservationCode} · {formatDateTime(guarantee.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular text-petrol-900">
                        {amount(guarantee.currency, guarantee.amount)}
                      </p>
                      <Chip>{human(guarantee.state)}</Chip>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Últimas corroboraciones" count={state.audits.length} />
          {state.audits.length === 0 ? (
            <EmptyState message="Todavía no se ha corroborado la caja desde esta pantalla." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {state.audits.map((audit) => (
                <li key={audit.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-petrol-900">
                        {audit.currency} · {audit.countedByName}
                      </p>
                      <p className="text-xs text-slate-500">{formatDateTime(audit.createdAt)}</p>
                    </div>
                    <Badge tone={audit.difference === 0 ? 'resuelto' : 'atencion'}>
                      {audit.difference === 0
                        ? 'Cuadra'
                        : `Diferencia ${audit.difference > 0 ? '+' : ''}${audit.difference}`}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Esperado {amount(audit.currency, audit.expectedAmount)} · contado{' '}
                    {amount(audit.currency, audit.countedAmount)}
                  </p>
                  {audit.notes ? <p className="mt-1 text-xs text-slate-500">{audit.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Movimientos recientes" count={state.movements.length} />
        {state.movements.length === 0 ? (
          <EmptyState message="Todavía no hay movimientos en Caja viva." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Movimiento</th>
                  <th className="px-4 py-2 font-medium">Contexto</th>
                  <th className="px-4 py-2 font-medium">Usuario</th>
                  <th className="px-4 py-2 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(movement.createdAt)}</td>
                    <td className="px-4 py-2">
                      <span className="font-medium text-petrol-900">
                        {MOVEMENT_LABEL[movement.kind] ?? human(movement.kind)}
                      </span>
                      {movement.reference ? <p className="text-xs text-slate-500">{movement.reference}</p> : null}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {movement.roomNumber ? `Hab. ${movement.roomNumber}` : '—'}
                      {movement.reservationCode ? ` · rva. ${movement.reservationCode}` : ''}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">{movement.createdByName}</td>
                    <td className={`px-4 py-2 text-right font-semibold tabular ${movement.direction === 'ENTRADA' ? 'text-emerald-700' : 'text-red-700'}`}>
                      {movement.direction === 'ENTRADA' ? '+' : '−'}{amount(movement.currency, movement.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Dumbbell className="h-4 w-4 text-petrol-600" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-petrol-900">Folios de gimnasio</h2>
              <p className="text-xs text-slate-500">Correlativos únicos de cuatro dígitos · 1 pax = 1 folio.</p>
            </div>
          </div>
          {canOperate ? (
            <Link href="/habitaciones" className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline">
              Ir a habitaciones <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {state.gymPasses.length === 0 ? (
          <EmptyState message="Todavía no se han emitido folios." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {state.gymPasses.map((pass) => {
              const legacyPaidPass = pass.amount > 0 && Boolean(pass.currency);
              return (
                <li key={pass.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold tabular tracking-wider text-petrol-900">
                        {formatGymFolio(pass.folio)}
                      </span>
                      <Badge tone={pass.status === 'EMITIDO' ? 'resuelto' : 'neutro'}>
                        {human(pass.status)}
                      </Badge>
                      {legacyPaidPass ? <Chip>Folio histórico con cobro</Chip> : <Chip>Informativo</Chip>}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-700">
                      Hab. {pass.roomNumber} · {pass.guestName} · rva. {pass.reservationCode}
                    </p>
                    <p className="text-xs text-slate-500">
                      {pass.receptionistName} · {formatDateTime(pass.issuedAt)}
                      {legacyPaidPass ? ` · ${amount(pass.currency, pass.amount)}` : ''}
                    </p>
                    {pass.voidReason ? <p className="mt-1 text-xs text-red-700">Anulado: {pass.voidReason}</p> : null}
                  </div>
                  {canOperate && pass.status === 'EMITIDO' ? (
                    <div className="no-print"><VoidGymPassDialog id={pass.id} folio={pass.folio} /></div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        Los folios de gimnasio son información operativa. Sólo garantías y movimientos reales alteran el saldo físico de Caja.
      </p>
    </div>
  );
}
