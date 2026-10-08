import { randomUUID } from 'node:crypto';
import {SubjectActions} from '@/components/operational/subject-surface';
import Link from 'next/link';
import { Banknote, Download, PlusCircle, Printer, ShieldCheck, Ticket } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { getLiveCashState } from '@/server/services/live-cash';
import { getReceptionOperationGate } from '@/server/services/reception-operation-gate';
import { listGymPasses, listParkingPasses } from '@/server/services/gym-pass';
import { Card, CardHeader, CardScroll, EmptyState } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { Badge, Chip } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import {
  CashDifferenceRegularizationForm,
  ChargeCashGuaranteeForm,
  CreateCashGuaranteeForm,
  EditCashGuaranteeForm,
  CreateGymPassForm,
  CreateParkingPassForm,
  LiveCashAuditDialog,
  ManualCashMovementForm,
  ReclassifyCashMovementDialog,
  ReturnCashGuaranteeForm,
  VoidGymPassDialog,
} from '@/components/cash/live-cash-forms';
import { formatCalendarDate, formatDateTime, toDateTimeInput } from '@/lib/format';
import { addHotelCalendarDays, hotelDateKey, hotelWallDateTime } from '@/domain/time';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Caja' };
export const dynamic = 'force-dynamic';

const MOVEMENT_LABEL: Record<string, string> = {
  GARANTIA_INGRESO: 'Garantía recibida',
  GARANTIA_DEVOLUCION: 'Garantía devuelta',
  GARANTIA_COBRO: 'Garantía cobrada',
  VENTA_GIMNASIO: 'Movimiento histórico',
  ANULACION_GIMNASIO: 'Reverso histórico',
  TESORERIA: 'Transferencia a Tesorería',
  AJUSTE_ENTRADA: 'Ingreso manual',
  AJUSTE_SALIDA: 'Egreso manual',
  REGULARIZACION_ENTRADA: 'Regularización · entrada',
  REGULARIZACION_SALIDA: 'Regularización · salida',
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
  const q = typeof params.q === 'string' ? params.q.trim().replace(/^#/, '').toLowerCase() : '';
  const moneda = typeof params.moneda === 'string' ? params.moneda : '';
  const seccion = typeof params.seccion === 'string' ? params.seccion : '';
  const roomContext = typeof params.habitacion === 'string' ? params.habitacion : '';
  const returnCandidate = typeof params.volver === 'string' ? params.volver : '';
  const hasReturnToHandover = returnCandidate.startsWith('/turno/entrega/');
  const returnHref = hasReturnToHandover ? returnCandidate : '/turno';
  const todayKey = hotelDateKey(new Date());
  const defaultFrom = `${todayKey.slice(0, 8)}01`;
  const gymFrom = typeof params.desde === 'string' && params.desde ? params.desde : defaultFrom;
  const gymTo = typeof params.hasta === 'string' && params.hasta ? params.hasta : todayKey;
  const historyFrom = hotelWallDateTime(gymFrom, 0);
  const historyTo = new Date(addHotelCalendarDays(hotelWallDateTime(gymTo, 0), 1).getTime() - 1);
  const [operationGate, state, gymSummary, parkingSummary] = await Promise.all([
    getReceptionOperationGate(user),
    getLiveCashState({
      query: q || undefined,
      currency: moneda || undefined,
      from: historyFrom,
      to: historyTo,
      movementLimit: 50,
      auditLimit: 50,
    }),
    listGymPasses({ from: gymFrom, to: gymTo, limit: 1000 }),
    listParkingPasses({ from: gymFrom, to: gymTo, limit: 1000 }),
  ]);
  const canOperateCash = operationGate.mode === 'ACTIVE';
  const canReturnDuringClosing = operationGate.mode === 'CLOSING' && operationGate.shiftStatus === 'PREPARANDO_ENTREGA';

  const canManualIn = canOperateCash && hasPermission(user, 'cash.manual_in');
  const canManualOut = canOperateCash && hasPermission(user, 'cash.manual_out');
  const canManual = canManualIn || canManualOut;
  const canAudit = canOperateCash && hasPermission(user, 'cash.audit');
  const canCreateGuarantee = canOperateCash && hasPermission(user, 'cash.guarantee_in');
  const canEditGuarantee = canOperateCash && hasPermission(user, 'cash.guarantee_in');
  const canReconcileDifference = canOperateCash && hasPermission(user, 'cash.approve');
  const canChargeGuarantee = canOperateCash && hasPermission(user, 'cash.guarantee_out');
  const canReturnGuarantee = (canOperateCash || canReturnDuringClosing) && hasPermission(user, 'cash.guarantee_out');

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
      (!roomContext || item.roomNumber === roomContext) &&
      matches([
        item.humanId,
        item.guestName,
        item.roomNumber,
        item.reference,
        item.state,
        item.currency,
        item.amount,
      ]),
  );
  // Arqueos y movimientos ya llegan filtrados desde PostgreSQL. Así la búsqueda
  // no puede responder «sin resultados» sólo porque el registro quedó fuera de
  // la muestra cargada en memoria.
  const visibleAudits = state.audits;
  const visibleMovements = state.movements;
  const visibleGymPasses = gymSummary.rows.filter((item) =>
    matches([
      item.humanId,
      item.formattedFolio,
      item.roomNumber,
      item.guestName,
      item.receptionistName,
      item.status,
    ]),
  );
  const visibleParkingPasses = parkingSummary.rows.filter((item) =>
    matches([
      item.humanId,
      item.formattedFolio,
      item.roomNumber,
      item.guestName,
      item.reservationCode,
      item.receptionistName,
      item.status,
    ]),
  );

  const show = (name: string) => !seccion || seccion === name;
  const gymCsvQuery = new URLSearchParams({ desde: gymFrom, hasta: gymTo }).toString();
  const parkingCsvQuery = gymCsvQuery;

  const manualAction = (canManual ? (
            <Dialog
              title="Registrar movimiento de Caja"
              description="Registra un ingreso o egreso operativo nuevo. Si el dinero sólo corrige un faltante o sobrante anterior, usa «Regularizar diferencia»."
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
          ) : null);
  const guaranteeAction = (canCreateGuarantee ? (
            <Dialog
              title="Registrar garantía en efectivo"
              description="Registra el dinero recibido bajo custodia. La habitación se selecciona del catálogo y alimenta Novedades / habitación; huésped y referencia siguen siendo contexto libre."
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
              <CreateCashGuaranteeForm defaultRoomNumber={roomContext || undefined} />
            </Dialog>
          ) : null);
  const extraActions = (canOperateCash || canReconcileDifference ? <>
{canOperateCash ? (
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
          ) : null}
{canOperateCash ? (
            <Dialog
              title="Generar ticket de estacionamiento"
              description="Registra fecha, habitación, huésped e ID Reserva de FNSrooms. AROH no administra la reserva."
              triggerVariant="secondary"
              triggerSize="sm"
              width="sm"
              trigger={
                <>
                  <Ticket className="h-4 w-4" aria-hidden="true" />
                  Ticket estacionamiento
                </>
              }
            >
              <CreateParkingPassForm defaultServiceDate={todayKey} />
            </Dialog>
          ) : null}
{canReconcileDifference ? (
            <Dialog
              title="Regularizar diferencia de Caja"
              description="Úsalo cuando entra dinero que faltaba o sale un sobrante previamente detectado. Corrige el efectivo esperado y deja trazabilidad sin tratarlo como un ingreso o egreso operacional nuevo."
              triggerVariant="secondary"
              triggerSize="sm"
              width="sm"
              trigger={
                <>
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Regularizar diferencia
                </>
              }
            >
              <CashDifferenceRegularizationForm />
            </Dialog>
          ) : null}
          </> : null);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-petrol-900">Caja</h1>
        </div>

        <div className="w-full md:w-auto" aria-label="Acciones de Caja">
          <SubjectActions primary={manualAction ?? guaranteeAction} secondary={manualAction ? guaranteeAction : null} more={extraActions}/>
        </div>
      </header>

      <section aria-label="Estado actual de Caja" className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-slate-300 bg-white px-3 py-2 text-sm">
        <p className="font-semibold">{canOperateCash ? 'Caja operativa' : canReturnDuringClosing ? 'Caja durante cierre' : 'Caja en consulta'}</p>
        <p className="sr-only">Siguiente acción: {canOperateCash ? 'revisar el efectivo esperado y registrar lo ocurrido; el arqueo confirma el conteo físico.' : canReturnDuringClosing ? 'devolver únicamente una garantía en efectivo que deba salir físicamente antes de terminar el cierre.' : 'continuar el paso pendiente de Mi turno.'}</p>
        <div className="flex flex-wrap gap-3"><Link className="underline" href="/caja?seccion=auditorias">Revisar arqueos y diferencias</Link><Link className="underline" href="/caja?seccion=movimientos">Ver movimientos registrados</Link>{hasReturnToHandover ? <Link className="font-semibold underline" href={returnHref}>Volver al cierre</Link> : !canOperateCash ? <Link className="font-semibold underline" href="/turno">Continuar Mi turno</Link> : null}</div>
      </section>

      {!canOperateCash ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
          <p className="font-semibold">Caja en modo consulta</p>
          <p className="mt-1">
            {operationGate.mode === 'NO_SHIFT'
              ? 'Inicia tu turno antes de registrar movimientos, garantías, arqueos o folios.'
              : operationGate.mode === 'HANDOVER_PENDING'
                ? 'Recibe primero la entrega pendiente y recuenta Caja desde Mi turno.'
                : operationGate.mode === 'RECEIVING'
                  ? 'Completa la recepción del turno antes de operar Caja.'
                  : canReturnDuringClosing
                    ? 'El cierre sigue activo. Sólo puedes devolver físicamente una garantía vigente; cobros, nuevas garantías y demás operaciones continúan bloqueados.'
                    : 'Tu turno está en cierre. Completa Caja desde el cierre guiado y termina el turno antes de volver a operar.'}
          </p>
        </div>
      ) : null}

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar concepto, referencia, responsable o garantía…"
        clearHref="/caja"
        collapseChildren
        activeFilterCount={[moneda,seccion,params.desde,params.hasta].filter(Boolean).length}
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
            <option value="auditorias">Arqueos</option>
            <option value="gimnasio">Folios gimnasio</option>
            <option value="estacionamiento">Tickets estacionamiento</option>
            <option value="movimientos">Movimientos</option>
          </select>
        </label>
        <label className="min-w-[10rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Historial desde</span>
          <input
            type="date"
            name="desde"
            defaultValue={gymFrom}
            className="input-base w-full"
          />
        </label>
        <label className="min-w-[10rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Historial hasta</span>
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
                    <LiveCashAuditDialog
                      currency={item.currency}
                      fund={item.fund}
                      denominations={state.denominations
                        .filter((row) => row.currency === item.currency)
                        .map((row) => ({
                          id: row.id,
                          value: row.value,
                          medium: row.medium,
                        }))}
                      guarantees={state.cashGuarantees
                        .filter((guarantee) => guarantee.currency === item.currency)
                        .map((guarantee) => ({
                          id: guarantee.id,
                          amount: guarantee.amount,
                          guestName: guarantee.guestName,
                          roomNumber: guarantee.roomNumber,
                          reference: guarantee.reference,
                        }))}
                    />
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
              action={<span className="text-xs text-slate-500">Estado vigente · no se oculta por período</span>}
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
                            #{guarantee.humanId} · {guarantee.guestName ?? guarantee.reference ?? 'Garantía sin referencia'}
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
                          <p className="mt-1 text-xs text-slate-600">
                            Original {amount(guarantee.currency, guarantee.originalAmount)}
                            {' · '}aplicado/cobrado {amount(guarantee.currency, guarantee.appliedAmount + guarantee.penaltyAmount)}
                            {' · '}devuelto {amount(guarantee.currency, guarantee.returnedAmount)}
                            {' · '}saldo {amount(guarantee.currency, guarantee.amount)}
                          </p>
                          {guarantee.settlements.length ? (
                            <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                              <summary className="cursor-pointer text-xs font-semibold text-petrol-800">
                                Historial de liquidaciones ({guarantee.settlements.length})
                              </summary>
                              <ul className="mt-2 space-y-2 text-xs text-slate-600">
                                {guarantee.settlements.map((settlement) => (
                                  <li key={settlement.id} className="rounded-md bg-white px-2 py-2 ring-1 ring-slate-200">
                                    <p className="font-medium text-petrol-900">
                                      {settlement.kind === 'DEVOLUCION' ? 'Devolución' : 'Cobro'} · {amount(settlement.currency, settlement.amount)}
                                    </p>
                                    <p>{settlement.reason}</p>
                                    <p className="text-slate-500">{settlement.createdByName} · {formatDateTime(settlement.createdAt)}</p>
                                    {settlement.notes ? <p className="mt-1 whitespace-pre-wrap">{settlement.notes}</p> : null}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-2 text-right">
                          <div>
                            <p className="font-semibold tabular text-petrol-900">
                              {amount(guarantee.currency, guarantee.amount)}
                            </p>
                            <Chip>{human(guarantee.state)}</Chip>
                          </div>
                          {canEditGuarantee || canChargeGuarantee || canReturnGuarantee ? (
                            <div className="flex flex-wrap justify-end gap-2">
                              {canEditGuarantee ? (
                                <EditCashGuaranteeForm
                                  guaranteeId={guarantee.id}
                                  humanId={guarantee.humanId}
                                  currency={guarantee.currency}
                                  amount={guarantee.originalAmount}
                                  guestName={guarantee.guestName}
                                  roomNumber={guarantee.roomNumber}
                                  reference={guarantee.reference}
                                  dueAt={guarantee.dueAt ? toDateTimeInput(guarantee.dueAt) : ''}
                                  notes={guarantee.notes}
                                />
                              ) : null}
                              {canChargeGuarantee ? (
                                <ChargeCashGuaranteeForm
                                  guaranteeId={guarantee.id}
                                  requestKey={randomUUID()}
                                  humanId={guarantee.humanId}
                                  reference={guarantee.reference ?? guarantee.guestName}
                                  currency={guarantee.currency}
                                  amount={guarantee.amount}
                                  guestName={guarantee.guestName}
                                  roomNumber={guarantee.roomNumber}
                                />
                              ) : null}
                              {canReturnGuarantee ? (
                                <ReturnCashGuaranteeForm
                                  guaranteeId={guarantee.id}
                                  requestKey={randomUUID()}
                                  reference={guarantee.reference ?? guarantee.guestName}
                                  currency={guarantee.currency}
                                  amount={guarantee.amount}
                                  guestName={guarantee.guestName}
                                  roomNumber={guarantee.roomNumber}
                                />
                              ) : null}
                            </div>
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
            <CardHeader
              title="Arqueos del período"
              count={state.auditTotal}
              action={state.auditTotal > visibleAudits.length ? <span className="text-xs text-slate-500">Mostrando {visibleAudits.length} de {state.auditTotal}</span> : null}
            />
            {visibleAudits.length === 0 ? (
              <EmptyState message="Todavía no se ha registrado ningún arqueo desde esta pantalla." />
            ) : (
              <CardScroll>
                <ul className="divide-y divide-slate-100">
                  {visibleAudits.map((audit) => (
                    <li key={audit.id} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-petrol-900">
                            #{audit.humanId} · {audit.currency} · {audit.countedByName}
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
                        Fondo esperado {amount(audit.currency, audit.expectedAmount)} · fondo contado{' '}
                        {amount(audit.currency, audit.countedAmount)}
                        {' · '}garantías validadas {audit.guaranteeCount}
                        {audit.guaranteeCount > 0
                          ? ` (${amount(audit.currency, audit.guaranteeAmount)})`
                          : ''}
                      </p>
                      {audit.notes ? (
                        <p className="mt-1 text-xs text-slate-500">{audit.notes}</p>
                      ) : null}
                      <div className="mt-2 no-print">
                        <Link
                          href={`/caja/arqueos/${audit.id}`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-petrol-700 hover:underline"
                        >
                          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                          Ver / imprimir arqueo
                        </Link>
                      </div>
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

      {show('estacionamiento') ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="font-semibold text-petrol-900">Tickets de estacionamiento</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatCalendarDate(new Date(`${gymFrom}T00:00:00.000Z`))} a{' '}
                {formatCalendarDate(new Date(`${gymTo}T00:00:00.000Z`))}
              </p>
            </div>
            <Link
              href={`/api/caja/estacionamiento?${parkingCsvQuery}`}
              className="inline-flex items-center gap-2 rounded-lg bg-petrol-700 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-800"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Descargar CSV
            </Link>
          </div>

          <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Total tickets</p>
              <p className="mt-1 text-xl font-semibold tabular text-petrol-900">{parkingSummary.total}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Emitidos</p>
              <p className="mt-1 text-xl font-semibold tabular text-petrol-900">{parkingSummary.emitted}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Anulados</p>
              <p className="mt-1 text-xl font-semibold tabular text-petrol-900">{parkingSummary.voided}</p>
            </div>
          </div>

          {visibleParkingPasses.length === 0 ? (
            <EmptyState message="No hay tickets de estacionamiento en el rango seleccionado." />
          ) : (
            <CardScroll>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Ticket</th>
                      <th className="px-4 py-2 font-medium">Fecha</th>
                      <th className="px-4 py-2 font-medium">Habitación</th>
                      <th className="px-4 py-2 font-medium">Huésped</th>
                      <th className="px-4 py-2 font-medium">ID Reserva</th>
                      <th className="px-4 py-2 font-medium">Recepcionista</th>
                      <th className="px-4 py-2 font-medium">Estado</th>
                      <th className="px-4 py-2 text-right font-medium">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleParkingPasses.map((pass) => (
                      <tr key={pass.id}>
                        <td className="px-4 py-2 font-semibold tabular text-petrol-900">{pass.formattedFolio}</td>
                        <td className="px-4 py-2 text-slate-600">{formatCalendarDate(pass.serviceDate)}</td>
                        <td className="px-4 py-2 text-slate-600">{pass.roomNumber}</td>
                        <td className="px-4 py-2 text-slate-600">{pass.guestName}</td>
                        <td className="px-4 py-2 font-mono font-semibold text-petrol-900">{pass.reservationCode ?? "—"}</td>
                        <td className="px-4 py-2 text-slate-600">{pass.receptionistName}</td>
                        <td className="px-4 py-2">
                          <Badge tone={pass.status === 'EMITIDO' ? 'resuelto' : 'neutro'}>
                            {pass.status === 'EMITIDO' ? 'Emitido' : 'Anulado'}
                          </Badge>
                          {pass.voidReason ? <p className="mt-1 max-w-[14rem] text-xs text-slate-500">{pass.voidReason}</p> : null}
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
          <CardHeader
            title="Movimientos del período"
            count={state.movementTotal}
            action={state.movementTotal > visibleMovements.length ? <span className="text-xs text-slate-500">Mostrando {visibleMovements.length} de {state.movementTotal}</span> : null}
          />
          {visibleMovements.length === 0 ? (
            <EmptyState message="Todavía no hay movimientos en Caja." />
          ) : (
            <CardScroll>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Fecha efectiva</th>
                      <th className="px-4 py-2 font-medium">Registrado</th>
                      <th className="px-4 py-2 font-medium">Movimiento</th>
                      <th className="px-4 py-2 font-medium">Referencia</th>
                      <th className="px-4 py-2 font-medium">Usuario</th>
                      <th className="px-4 py-2 text-right font-medium">Monto</th>
                      <th className="px-4 py-2 text-right font-medium">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleMovements.map((movement) => (
                      <tr key={movement.id}>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {formatDateTime(movement.effectiveAt)}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {formatDateTime(movement.createdAt)}
                        </td>
                        <td className="px-4 py-2">
                          <span className="font-medium text-petrol-900">
                            #{movement.humanId} · {movement.affectsExpected
                              ? MOVEMENT_LABEL[movement.kind] ?? human(movement.kind)
                              : 'Regularización de diferencia'}
                          </span>
                          {!movement.affectsExpected ? (
                            <div className="mt-1">
                              <Badge tone="resuelto">No altera esperado</Badge>
                            </div>
                          ) : null}
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
                        <td className="px-4 py-2 text-right">
                          {canReconcileDifference &&
                          movement.affectsExpected &&
                          (movement.kind === 'AJUSTE_ENTRADA' || movement.kind === 'AJUSTE_SALIDA') ? (
                            <ReclassifyCashMovementDialog
                              movementId={movement.id}
                              label={`${movement.currency} ${movement.amount.toLocaleString('es-CL')} · ${movement.reference ?? 'sin referencia'}`}
                            />
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

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        Caja mantiene su propia trazabilidad financiera. Las referencias son contexto libre y no crean ni administran datos PMS.
      </p>
    </div>
  );
}
