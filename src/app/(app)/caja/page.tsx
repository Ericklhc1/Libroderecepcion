import Link from 'next/link';
import { ArrowRight, Banknote, Dumbbell, PlusCircle, Scale, ShieldCheck } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import {
  formatGymFolio,
  getLiveCashStateWithGym as getLiveCashState,
} from '@/server/services/gym-pass';
import { Card, CardHeader, CardScroll, EmptyState } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { Badge, Chip } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import {
  LiveCashAuditForm,
  ManualCashMovementForm,
  ReturnCashGuaranteeForm,
  VoidGymPassDialog,
} from '@/components/cash/live-cash-forms';
import { formatDateTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Caja' };
export const dynamic = 'force-dynamic';

const MOVEMENT_LABEL: Record<string, string> = {
  GARANTIA_INGRESO: 'Garantía recibida',
  GARANTIA_DEVOLUCION: 'Garantía devuelta',
  VENTA_GIMNASIO: 'Pase gimnasio histórico',
  ANULACION_GIMNASIO: 'Anulación gimnasio histórica',
  TESORERIA: 'Egreso a tesorería',
  AJUSTE_ENTRADA: 'Ingreso manual',
  AJUSTE_SALIDA: 'Egreso manual',
};

function amount(currency: string, value: number) {
  return `${currency} ${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`;
}

function human(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

export default async function LiveCashPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePagePermission('cash.view');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const moneda = typeof params.moneda === 'string' ? params.moneda : '';
  const seccion = typeof params.seccion === 'string' ? params.seccion : '';
  const state = await getLiveCashState();
  const canManualIn = hasPermission(user, 'cash.manual_in');
  const canManualOut = hasPermission(user, 'cash.manual_out');
  const canManual = canManualIn || canManualOut;
  const canAudit = hasPermission(user, 'cash.audit');
  const canReturnGuarantee = hasPermission(user, 'cash.guarantee_out');
  const canOperateRooms = hasPermission(user, 'room.manage');

  const matches = (values: Array<string | number | null | undefined>) =>
    !q || values.filter((value) => value !== null && value !== undefined).join(' ').toLowerCase().includes(q);

  const visibleGuarantees = state.cashGuarantees.filter(
    (item) =>
      (!moneda || item.currency === moneda) &&
      matches([item.guestName, item.roomNumber, item.reservationCode, item.state, item.currency, item.amount]),
  );
  const visibleAudits = state.audits.filter(
    (item) =>
      (!moneda || item.currency === moneda) &&
      matches([item.currency, item.countedByName, item.notes, item.expectedAmount, item.countedAmount, item.difference]),
  );
  const visibleMovements = state.movements.filter(
    (item) =>
      (!moneda || item.currency === moneda) &&
      matches([
        item.kind,
        item.direction,
        item.currency,
        item.amount,
        item.reference,
        item.notes,
        item.roomNumber,
        item.reservationCode,
        item.guestName,
        item.createdByName,
      ]),
  );
  const visibleGymPasses = state.gymPasses.filter((item) =>
    matches([item.folio, item.roomNumber, item.guestName, item.reservationCode, item.receptionistName, item.status]),
  );

  const show = (name: string) => !seccion || seccion === name;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-petrol-900">Caja</h1>
          <p className="mt-1 text-sm text-slate-600">
            Fuente operativa del efectivo: fondo fijo, saldo esperado, ingresos, egresos, garantías en custodia y corroboraciones. La habitación o reserva sólo agregan contexto cuando corresponde.
          </p>
        </div>
        {canManual || canOperateRooms ? (
          <div className="flex flex-wrap gap-2 no-print">
            {canManual ? <Dialog
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
              <ManualCashMovementForm allowIn={canManualIn} allowOut={canManualOut} />
            </Dialog> : null}
            {canOperateRooms ? <Link
              href="/habitaciones"
              className="inline-flex items-center gap-2 rounded-lg bg-petrol-800 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-700"
            >
              <Dumbbell className="h-4 w-4" aria-hidden="true" />
              Generar pase desde habitación
            </Link> : null}
          </div>
        ) : null}
      </header>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar concepto, referencia, responsable, huésped o habitación…"
        clearHref="/caja"
      >
        <label className="min-w-[10rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Moneda</span>
          <select name="moneda" defaultValue={moneda} className="input-base w-full">
            <option value="">Todas</option>
            <option value="CLP">CLP</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Sección</span>
          <select name="seccion" defaultValue={seccion} className="input-base w-full">
            <option value="">Todas</option>
            <option value="garantias">Garantías</option>
            <option value="auditorias">Corroboraciones</option>
            <option value="movimientos">Movimientos</option>
            <option value="gimnasio">Folios gimnasio</option>
          </select>
        </label>
      </ListFilterBar>

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
                {canAudit ? <div className="mt-3 no-print">
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
                    <LiveCashAuditForm
                      currency={item.currency}
                      denominations={state.denominations
                        .filter((row) => row.currency === item.currency)
                        .map((row) => ({
                          id: row.id,
                          value: row.value,
                          medium: row.medium,
                        }))}
                    />
                  </Dialog>
                </div> : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {show('garantias') ? <Card>
          <CardHeader title="Garantías en efectivo bajo custodia" count={visibleGuarantees.length} />
          {visibleGuarantees.length === 0 ? (
            <EmptyState message="No hay garantías en efectivo activas." />
          ) : (
            <CardScroll>
              <ul className="divide-y divide-slate-100">
              {visibleGuarantees.map((guarantee) => (
                <li key={guarantee.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-petrol-900">
                        {guarantee.guestName ?? 'Huésped sin nombre'}
                        {guarantee.roomNumber ? ` · Hab. ${guarantee.roomNumber}` : ''}
                      </p>
                      <p className="text-xs tabular text-slate-500">
                        ID FNS {guarantee.reservationCode} · {formatDateTime(guarantee.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right">
                      <div>
                        <p className="font-semibold tabular text-petrol-900">
                          {amount(guarantee.currency, guarantee.amount)}
                        </p>
                        <Chip>{human(guarantee.state)}</Chip>
                      </div>
                      {canReturnGuarantee ? (
                        <ReturnCashGuaranteeForm
                          guaranteeId={guarantee.id}
                          reservationCode={guarantee.reservationCode}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
              </ul>
            </CardScroll>
          )}
        </Card> : null}

        {show('auditorias') ? <Card>
          <CardHeader title="Últimas corroboraciones" count={visibleAudits.length} />
          {visibleAudits.length === 0 ? (
            <EmptyState message="Todavía no se ha corroborado la caja desde esta pantalla." />
          ) : (
            <CardScroll>
              <ul className="divide-y divide-slate-100">
              {visibleAudits.map((audit) => (
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
            </CardScroll>
          )}
        </Card> : null}
      </div>

      {show('movimientos') ? <Card>
        <CardHeader title="Movimientos recientes" count={visibleMovements.length} />
        {visibleMovements.length === 0 ? (
          <EmptyState message="Todavía no hay movimientos en Caja viva." />
        ) : (
          <CardScroll>
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
                {visibleMovements.map((movement) => (
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
          </CardScroll>
        )}
      </Card> : null}

      {show('gimnasio') ? <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Dumbbell className="h-4 w-4 text-petrol-600" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-petrol-900">Folios de gimnasio</h2>
              <p className="text-xs text-slate-500">Correlativos únicos de cuatro dígitos · 1 pax = 1 folio.</p>
            </div>
          </div>
          {canOperateRooms ? (
            <Link href="/habitaciones" className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline">
              Ir a habitaciones <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {visibleGymPasses.length === 0 ? (
          <EmptyState message="Todavía no se han emitido folios." />
        ) : (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {visibleGymPasses.map((pass) => {
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
                  {canOperateRooms && pass.status === 'EMITIDO' ? (
                    <div className="no-print"><VoidGymPassDialog id={pass.id} folio={pass.folio} /></div>
                  ) : null}
                </li>
              );
            })}
            </ul>
          </CardScroll>
        )}
      </Card> : null}

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        Los folios de gimnasio son información operativa. Sólo garantías y movimientos reales alteran el saldo físico de Caja.
      </p>
    </div>
  );
}
