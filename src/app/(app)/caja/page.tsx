import Link from 'next/link';
import { Banknote, Download, PlusCircle, Scale, ShieldCheck, Ticket } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { getLiveCashState } from '@/server/services/live-cash';
import { listGymPasses } from '@/server/services/gym-pass';
import { Card, CardHeader, CardScroll, EmptyState } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { Badge, Chip } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import {
  CreateCashGuaranteeForm,
  CreateGymPassForm,
  LiveCashAuditForm,
  ManualCashMovementForm,
  ReturnCashGuaranteeForm,
  VoidGymPassDialog,
} from '@/components/cash/live-cash-forms';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import { hotelDateKey } from '@/domain/time';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Caja' };
export const dynamic = 'force-dynamic';

const MOVEMENT_LABEL: Record<string, string> = {
  GARANTIA_INGRESO: 'Garantía recibida',
  GARANTIA_DEVOLUCION: 'Garantía devuelta',
  VENTA_GIMNASIO: 'Movimiento histórico',
  ANULACION_GIMNASIO: 'Reverso histórico',
  TESORERIA: 'Transferencia a Tesorería',
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
  const todayKey = hotelDateKey(new Date());
  const defaultFrom = `${todayKey.slice(0, 8)}01`;
  const gymFrom = typeof params.desde === 'string' && params.desde ? params.desde : defaultFrom;
  const gymTo = typeof params.hasta === 'string' && params.hasta ? params.hasta : todayKey;
  const [state, gymSummary] = await Promise.all([
    getLiveCashState(),
    listGymPasses({ from: gymFrom, to: gymTo, limit: 1000 }),
  ]);

  const canManualIn = hasPermission(user, 'cash.manual_in');
  const canManualOut = hasPermission(user, 'cash.manual_out');
  const canManual = canManualIn || canManualOut;
  const canAudit = hasPermission(user, 'cash.audit');
  const canCreateGuarantee = hasPermission(user, 'cash.guarantee_in');
  const canReturnGuarantee = hasPermission(user, 'cash.guarantee_out');

  const matches = (values: Array<string | number | null | undefined>) =>
    !q ||
    values
      .filter((value) => value !== null && value !== undefined)
      .join(' ')
      .toLowerCase()
      .includes(q);

  const visibleGuarantees = state.cashGuarantees.filter(
    (item) =>
      (!moneda || item.currency === moneda) &&
      matches([
        item.guestName,
        item.roomNumber,
        item.reference,
        item.state,
        item.currency,
        item.amount,
      ]),
  );
  const visibleAudits = state.audits.filter(
    (item) =>
      (!moneda || item.currency === moneda) &&
      matches([
        item.currency,
        item.countedByName,
        item.notes,
        item.expectedAmount,
        item.countedAmount,
        item.difference,
      ]),
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
        item.createdByName,
      ]),
  );
  const visibleGymPasses = gymSummary.rows.filter((item) =>
    matches([
      item.formattedFolio,
      item.roomNumber,
      item.guestName,
      item.receptionistName,
      item.status,
    ]),
  );

  const show = (name: string) => !seccion || seccion === name;
  const gymCsvQuery = new URLSearchParams({ desde: gymFrom, hasta: gymTo }).toString();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-petrol-900">Caja</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Fondo fijo, garantías bajo custodia, saldo operacional, transferencias,
            arqueos y diferencias. Caja funciona de forma autónoma: no necesita PMS,
            reservas ni estadías.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 no-print">
          {canCreateGuarantee ? (
            <Dialog
              title="Registrar garantía en efectivo"
              description="Registra el dinero recibido bajo custodia. El contexto de huésped, habitación o referencia es texto libre y opcional."
              triggerVariant="secondary"
              triggerSize="sm"
              width="sm"
              trigger={
                <>
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Nueva garantía
                </>
              }
            >
              <CreateCashGuaranteeForm />
            </Dialog>
          ) : null}

          <Dialog
            title="Generar folio de gimnasio"
            description="Registra fecha, habitación y huésped. El recepcionista se toma automáticamente de tu sesión."
            triggerVariant="secondary"
            triggerSize="sm"
            width="sm"
            trigger={
              <>
                <Ticket className="h-4 w-4" aria-hidden="true" />
                Folio gimnasio
              </>
            }
          >
            <CreateGymPassForm defaultServiceDate={todayKey} />
          </Dialog>

          {canManual ? (
            <Dialog
              title="Registrar movimiento de Caja"
              description="Registra un ingreso o egreso real. No requiere reserva, habitación ni estadía."
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
            </Dialog>
          ) : null}
        </div>
      </header>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar concepto, referencia, responsable o garantía…"
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
            <option value="gimnasio">Folios gimnasio</option>
            <option value="movimientos">Movimientos</option>
          </select>
        </label>
        <label className="min-w-[10rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Desde</span>
          <input
            type="date"
            name="desde"
            defaultValue={gymFrom}
            className="input-base w-full"
          />
        </label>
        <label className="min-w-[10rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Hasta</span>
          <input
            type="date"
            name="hasta"
            defaultValue={gymTo}
            className="input-base w-full"
          />
        </label>
      </ListFilterBar>

      {state.currencies.length === 0 ? (
        <Card>
          <EmptyState message="No hay fondo fijo ni movimientos de Caja registrados todavía." />
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
                    <dt className="text-slate-500">Garantías</dt>
                    <dd className="mt-0.5 font-semibold tabular text-petrol-900">
                      {amount(item.currency, item.guaranteeCustody)}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <dt className="text-slate-500">Saldo operacional</dt>
                    <dd className="mt-0.5 font-semibold tabular text-petrol-900">
                      {item.operational > 0 ? '+' : ''}
                      {amount(item.currency, item.operational)}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <dt className="text-slate-500">Transferible</dt>
                    <dd className="mt-0.5 font-semibold tabular text-petrol-900">
                      {amount(item.currency, item.transferable)}
                    </dd>
                  </div>
                </dl>

                {canAudit ? (
                  <div className="mt-3 no-print">
                    <Dialog
                      title={`Corroborar Caja ${item.currency}`}
                      description={`Efectivo físico esperado: ${amount(item.currency, item.expected)}. La diferencia se calcula contra la composición real, no contra el fondo fijo.`}
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
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {show('garantias') ? (
          <Card>
            <CardHeader
              title="Garantías en efectivo bajo custodia"
              count={visibleGuarantees.length}
            />
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
                            {guarantee.guestName ?? guarantee.reference ?? 'Garantía sin referencia'}
                            {guarantee.roomNumber ? ` · Hab. ${guarantee.roomNumber}` : ''}
                          </p>
                          <p className="text-xs tabular text-slate-500">
                            {guarantee.reference ? `${guarantee.reference} · ` : ''}
                            {formatDateTime(guarantee.createdAt)}
                          </p>
                          {guarantee.dueAt ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              Vigencia / fecha objetivo: {formatDateTime(guarantee.dueAt)}
                            </p>
                          ) : null}
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
                              reference={guarantee.reference ?? guarantee.guestName}
                            />
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardScroll>
            )}
          </Card>
        ) : null}

        {show('auditorias') ? (
          <Card>
            <CardHeader title="Últimas corroboraciones" count={visibleAudits.length} />
            {visibleAudits.length === 0 ? (
              <EmptyState message="Todavía no se ha corroborado la Caja desde esta pantalla." />
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
                          <p className="text-xs text-slate-500">
                            {formatDateTime(audit.createdAt)}
                          </p>
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
                      {audit.notes ? (
                        <p className="mt-1 text-xs text-slate-500">{audit.notes}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardScroll>
            )}
          </Card>
        ) : null}
      </div>

      {show('gimnasio') ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="font-semibold text-petrol-900">Folios de gimnasio</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatCalendarDate(new Date(`${gymFrom}T00:00:00.000Z`))} a{' '}
                {formatCalendarDate(new Date(`${gymTo}T00:00:00.000Z`))}
              </p>
            </div>
            <Link
              href={`/api/caja/gimnasio?${gymCsvQuery}`}
              className="inline-flex items-center gap-2 rounded-lg bg-petrol-700 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-800"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Descargar CSV
            </Link>
          </div>

          <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Total folios</p>
              <p className="mt-1 text-xl font-semibold tabular text-petrol-900">{gymSummary.total}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Emitidos</p>
              <p className="mt-1 text-xl font-semibold tabular text-petrol-900">{gymSummary.emitted}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Anulados</p>
              <p className="mt-1 text-xl font-semibold tabular text-petrol-900">{gymSummary.voided}</p>
            </div>
          </div>

          {visibleGymPasses.length === 0 ? (
            <EmptyState message="No hay folios de gimnasio en el rango seleccionado." />
          ) : (
            <CardScroll>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Folio</th>
                      <th className="px-4 py-2 font-medium">Fecha</th>
                      <th className="px-4 py-2 font-medium">Habitación</th>
                      <th className="px-4 py-2 font-medium">Huésped</th>
                      <th className="px-4 py-2 font-medium">Recepcionista</th>
                      <th className="px-4 py-2 font-medium">Estado</th>
                      <th className="px-4 py-2 text-right font-medium">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleGymPasses.map((pass) => (
                      <tr key={pass.id}>
                        <td className="px-4 py-2 font-semibold tabular text-petrol-900">
                          {pass.formattedFolio}
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          {formatCalendarDate(pass.serviceDate)}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{pass.roomNumber}</td>
                        <td className="px-4 py-2 text-slate-600">{pass.guestName}</td>
                        <td className="px-4 py-2 text-slate-600">{pass.receptionistName}</td>
                        <td className="px-4 py-2">
                          <Badge tone={pass.status === 'EMITIDO' ? 'resuelto' : 'neutro'}>
                            {pass.status === 'EMITIDO' ? 'Emitido' : 'Anulado'}
                          </Badge>
                          {pass.voidReason ? (
                            <p className="mt-1 max-w-[14rem] text-xs text-slate-500">{pass.voidReason}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {pass.status === 'EMITIDO' ? (
                            <VoidGymPassDialog id={pass.id} folio={pass.folio} />
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardScroll>
          )}
        </Card>
      ) : null}

      {show('movimientos') ? (
        <Card>
          <CardHeader title="Movimientos recientes" count={visibleMovements.length} />
          {visibleMovements.length === 0 ? (
            <EmptyState message="Todavía no hay movimientos en Caja." />
          ) : (
            <CardScroll>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Fecha</th>
                      <th className="px-4 py-2 font-medium">Movimiento</th>
                      <th className="px-4 py-2 font-medium">Referencia</th>
                      <th className="px-4 py-2 font-medium">Usuario</th>
                      <th className="px-4 py-2 text-right font-medium">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleMovements.map((movement) => (
                      <tr key={movement.id}>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {formatDateTime(movement.createdAt)}
                        </td>
                        <td className="px-4 py-2">
                          <span className="font-medium text-petrol-900">
                            {MOVEMENT_LABEL[movement.kind] ?? human(movement.kind)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-600">
                          {movement.reference ?? movement.notes ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-600">
                          {movement.createdByName}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-semibold tabular ${
                            movement.direction === 'ENTRADA'
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          }`}
                        >
                          {movement.direction === 'ENTRADA' ? '+' : '−'}
                          {amount(movement.currency, movement.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardScroll>
          )}
        </Card>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        Caja mantiene su propia trazabilidad financiera. Las referencias son contexto libre y no crean ni administran datos PMS.
      </p>
    </div>
  );
}
