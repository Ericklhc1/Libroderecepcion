'use client';

import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import {
  confirmCashCountAction,
  confirmElementsAction,
  declareCashCountAction,
  declareElementsAction,
  recordCashTransferAction,
  saveHandoverUsdRateAction,
} from '@/server/actions/cash';
import { CASH_MEDIUM_LABELS, fromMinor, type CashMediumValue } from '@/domain/cash';
import type { HandoverCashState } from '@/server/services/cash';

export type DenominationOption = {
  id: string;
  currency: string;
  value: number;
  medium: CashMediumValue;
};

function formatMinor(minor: number, currency: string): string {
  return `${currency} ${fromMinor(minor, currency).toLocaleString('es-CL')}`;
}

function FundRow({
  status,
}: {
  status: HandoverCashState['declared'] extends null
    ? never
    : NonNullable<HandoverCashState['declared']>['statuses'][number];
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 py-1 text-sm">
      <span className="font-medium text-petrol-900">{status.currency}</span>
      <span className="tabular text-slate-600">
        contado {formatMinor(status.countedMinor, status.currency)} · mínimo{' '}
        {formatMinor(status.fundMinor, status.currency)}
      </span>
      {status.balanced ? (
        <Badge tone="resuelto">Cuadra</Badge>
      ) : status.shortfallMinor > 0 ? (
        <Badge tone="atencion">Falta {formatMinor(status.shortfallMinor, status.currency)}</Badge>
      ) : (
        <Badge tone="pendiente">
          Sobra {formatMinor(status.surplusMinor, status.currency)} · puede egresarse a tesorería
        </Badge>
      )}
    </li>
  );
}

function CountForm({
  handoverId,
  denominations,
  kind,
  previous,
}: {
  handoverId: string;
  denominations: DenominationOption[];
  kind: 'declarar' | 'confirmar';
  previous: Record<string, number>;
}) {
  const byCurrency = new Map<string, DenominationOption[]>();
  for (const denomination of denominations) {
    const list = byCurrency.get(denomination.currency) ?? [];
    list.push(denomination);
    byCurrency.set(denomination.currency, list);
  }

  return (
    <ActionForm action={kind === 'declarar' ? declareCashCountAction : confirmCashCountAction}>
      <input type="hidden" name="handoverId" value={handoverId} />
      <div className="space-y-3">
        {[...byCurrency.entries()].map(([currency, rows]) => (
          <fieldset key={currency} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <legend className="px-1 text-sm font-semibold text-petrol-900">{currency}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {rows.map((denomination) => (
                <label key={denomination.id} className="text-xs text-slate-600">
                  <span className="block">
                    {denomination.value.toLocaleString('es-CL')}{' '}
                    <span className="text-slate-400">
                      {CASH_MEDIUM_LABELS[denomination.medium].toLowerCase()}
                    </span>
                  </span>
                  <Input
                    name={`d_${denomination.id}`}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    defaultValue={previous[denomination.id] ?? ''}
                    placeholder="0"
                    className="tabular"
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <Field label="Observaciones del arqueo" name="notes" hint="Sólo necesarias si existe una diferencia que explicar.">
        <Textarea name="notes" rows={2} maxLength={500} />
      </Field>

      <SubmitButton pendingLabel="Guardando arqueo…">
        {kind === 'declarar' ? 'Guardar arqueo declarado' : 'Confirmar arqueo recibido'}
      </SubmitButton>
    </ActionForm>
  );
}

function ElementsForm({
  handoverId,
  elements,
  kind,
}: {
  handoverId: string;
  elements: HandoverCashState['elements'];
  kind: 'declarar' | 'confirmar';
}) {
  const field = kind === 'declarar' ? 'declared' : 'confirmed';
  return (
    <ActionForm action={kind === 'declarar' ? declareElementsAction : confirmElementsAction}>
      <input type="hidden" name="handoverId" value={handoverId} />
      <ul className="space-y-2">
        {elements.map((element) => (
          <li key={element.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name={`e_${element.id}`}
              defaultChecked={element[field]}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-petrol-600"
            />
            <span>
              <span className="font-medium text-petrol-900">{element.name}</span>
              {element.required ? null : <span className="ml-1 text-xs text-slate-400">(opcional)</span>}
              {element.detail ? <span className="block text-xs text-slate-500">{element.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <SubmitButton variant="secondary" pendingLabel="Guardando…">
        {kind === 'declarar' ? 'Declarar elementos' : 'Confirmar que los recibo'}
      </SubmitButton>
    </ActionForm>
  );
}

export function CashBox({
  handoverId,
  state,
  denominations,
  previous,
  role,
}: {
  handoverId: string;
  state: HandoverCashState;
  denominations: DenominationOption[];
  previous: Record<string, number>;
  role: 'emisor' | 'receptor' | 'lector';
}) {
  if (!state.enabled) return null;

  return (
    <Card>
      <CardHeader
        title="Caja, garantías y elementos"
        action={state.discrepancies.length > 0 ? <Badge tone="atencion">Diferencia entre conteos</Badge> : null}
      />
      <div className="space-y-4 px-4 py-4">
        <p className="text-xs text-slate-500">
          Divisas operativas: CLP y USD. Caja mínima:{' '}
          {state.funds.map((fund) => `${fund.currency} ${fund.amount.toLocaleString('es-CL')}`).join(' · ')}.
          Estos mínimos se configuran desde Administración → Parámetros.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-petrol-900">Declarado al entregar</h3>
            {state.declared ? (
              <>
                <p className="mt-0.5 text-xs text-slate-500">
                  {state.declared.countedByName} · {state.declared.countedAt.toLocaleString('es-CL')}
                </p>
                <ul className="mt-1 divide-y divide-slate-100">
                  {state.declared.statuses.map((status) => <FundRow key={status.currency} status={status} />)}
                </ul>
                {state.declared.notes ? <p className="mt-1 text-xs text-slate-600">{state.declared.notes}</p> : null}
              </>
            ) : (
              <EmptyState message="Sin arquear todavía." />
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-petrol-900">Confirmado al recibir</h3>
            {state.confirmed ? (
              <>
                <p className="mt-0.5 text-xs text-slate-500">
                  {state.confirmed.countedByName} · {state.confirmed.countedAt.toLocaleString('es-CL')}
                </p>
                <ul className="mt-1 divide-y divide-slate-100">
                  {state.confirmed.statuses.map((status) => <FundRow key={status.currency} status={status} />)}
                </ul>
                {state.confirmed.notes ? <p className="mt-1 text-xs text-slate-600">{state.confirmed.notes}</p> : null}
              </>
            ) : (
              <EmptyState message="Pendiente de recuento por quien recibe." />
            )}
          </section>
        </div>

        {state.discrepancies.length > 0 ? (
          <div className="rounded-lg bg-orange-50 p-3 ring-1 ring-orange-200">
            <p className="text-sm font-semibold text-orange-900">Los dos conteos no coinciden</p>
            <ul className="mt-1 space-y-0.5 text-sm text-orange-800">
              {state.discrepancies.map((row) => (
                <li key={row.currency} className="tabular">
                  {row.currency}: se declararon {formatMinor(row.declaredMinor, row.currency)} y se contaron{' '}
                  {formatMinor(row.confirmedMinor, row.currency)} ({row.differenceMinor > 0 ? '+' : ''}
                  {fromMinor(row.differenceMinor, row.currency).toLocaleString('es-CL')})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section>
          <h3 className="text-sm font-semibold text-petrol-900">Garantías en efectivo heredables</h3>
          {state.cashGuarantees.length === 0 ? (
            <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">
              No se evidencian garantías en efectivo en caja.
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {state.cashGuarantees.map((guarantee) => (
                <li key={guarantee.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-petrol-900">
                      {guarantee.guestName ?? 'Huésped sin nombre'}
                      {guarantee.roomNumber ? ` · Hab. ${guarantee.roomNumber}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">ID / reserva {guarantee.reservationCode} · {guarantee.state.toLowerCase().replaceAll('_', ' ')}</p>
                  </div>
                  <span className="font-semibold tabular text-petrol-900">
                    {guarantee.currency} {guarantee.amount.toLocaleString('es-CL')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Las garantías pertenecen a la reserva/estadía, no a la habitación; se heredan entre turnos hasta su devolución, aplicación o cierre.
          </p>
        </section>

        {state.elements.length > 0 ? (
          <section>
            <h3 className="text-sm font-semibold text-petrol-900">Elementos</h3>
            {role === 'lector' ? (
              <ul className="mt-1 space-y-1 text-sm">
                {state.elements.map((element) => (
                  <li key={element.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-petrol-900">{element.name}</span>
                    <Badge tone={element.declared ? 'resuelto' : 'neutro'}>{element.declared ? 'Declarado' : 'Sin declarar'}</Badge>
                    <Badge tone={element.confirmed ? 'resuelto' : 'neutro'}>{element.confirmed ? 'Recibido' : 'Sin confirmar'}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1">
                <ElementsForm handoverId={handoverId} elements={state.elements} kind={role === 'emisor' ? 'declarar' : 'confirmar'} />
              </div>
            )}
          </section>
        ) : null}

        {state.transfers.length > 0 ? (
          <section>
            <h3 className="text-sm font-semibold text-petrol-900">Egresos a tesorería</h3>
            <ul className="mt-1 space-y-1 text-sm text-slate-600">
              {state.transfers.map((transfer) => (
                <li key={transfer.id} className="flex flex-wrap items-center gap-2 tabular">
                  <span>
                    {transfer.currency} {transfer.amount.toLocaleString('es-CL')}
                    {transfer.reference ? ` · comprobante ${transfer.reference}` : ''} · {transfer.createdByName}
                  </span>
                  <Badge tone={transfer.approved ? 'resuelto' : 'pendiente'}>
                    {transfer.approved ? 'Validado por Supervisión' : 'Pendiente de Supervisión'}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {role !== 'lector' ? (
          <div className="border-t border-slate-100 pt-3 no-print">
            <h3 className="mb-2 text-sm font-semibold text-petrol-900">
              {role === 'emisor' ? 'Contar y declarar la caja' : 'Recontar la caja'}
            </h3>
            <CountForm
              handoverId={handoverId}
              denominations={denominations}
              kind={role === 'emisor' ? 'declarar' : 'confirmar'}
              previous={previous}
            />
          </div>
        ) : null}

        {role === 'emisor' ? (
          <>
            <div className="border-t border-slate-100 pt-3 no-print">
              <h3 className="mb-2 text-sm font-semibold text-petrol-900">Declarar dólar operativo</h3>
              <ActionForm action={saveHandoverUsdRateAction}>
                <input type="hidden" name="handoverId" value={handoverId} />
                <Field label="Tipo de cambio USD/CLP" name="usdRateCLP" hint="Cuántos pesos chilenos equivalen a USD 1 durante este turno.">
                  <Input name="usdRateCLP" type="number" min="0.01" step="0.01" placeholder="Ej.: 950" />
                </Field>
                <SubmitButton variant="secondary" pendingLabel="Guardando…">Guardar dólar del turno</SubmitButton>
              </ActionForm>
            </div>

            <div className="border-t border-slate-100 pt-3 no-print">
              <h3 className="mb-1 text-sm font-semibold text-petrol-900">Registrar egreso a tesorería</h3>
              <p className="mb-2 text-xs text-slate-500">
                Opcional. Si el monto es 0 no se registra nada. Todo egreso mayor que 0 debe ser validado por Supervisión antes de enviar la entrega.
              </p>
              <ActionForm action={recordCashTransferAction}>
                <input type="hidden" name="handoverId" value={handoverId} />
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label="Divisa" name="currency">
                    <Select
                      name="currency"
                      defaultValue="CLP"
                      options={[
                        { value: 'CLP', label: 'CLP · Pesos chilenos' },
                        { value: 'USD', label: 'USD · Dólares' },
                      ]}
                    />
                  </Field>
                  <Field label="Monto" name="amount">
                    <Input name="amount" type="number" min={0} step="0.01" defaultValue={0} />
                  </Field>
                  <Field label="Comprobante" name="reference">
                    <Input name="reference" maxLength={60} placeholder="SOBRE-0912" />
                  </Field>
                </div>
                <SubmitButton variant="secondary" pendingLabel="Registrando…">Registrar egreso</SubmitButton>
              </ActionForm>
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}
