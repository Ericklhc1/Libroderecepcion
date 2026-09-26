'use client';

import { useMemo, useRef, useState } from 'react';
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
import { ReturnCashGuaranteeForm } from '@/components/cash/live-cash-forms';
import { closeShiftCashAction, reopenShiftCashAction } from '@/server/actions/cash-closure';
import { DenominationVisual } from '@/components/cash/denomination-visual';

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
  status: NonNullable<HandoverCashState['declared']>['statuses'][number];
}) {
  return (
    <li className="grid gap-1 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-petrol-900">{status.currency}</span>
        <span className="tabular text-slate-600">
          fondo contado {formatMinor(status.countedMinor, status.currency)} · fondo esperado{' '}
          {formatMinor(status.fundMinor, status.currency)}
        </span>
        {status.balanced ? (
          <Badge tone="resuelto">Cuadra</Badge>
        ) : status.shortfallMinor > 0 ? (
          <Badge tone="atencion">Falta {formatMinor(status.shortfallMinor, status.currency)}</Badge>
        ) : (
          <Badge tone="pendiente">
            Sobra físico {formatMinor(status.overageMinor, status.currency)}
          </Badge>
        )}
      </div>
      <p className="text-xs tabular text-slate-500">
        Las denominaciones validan únicamente el fondo fijo. Las garantías se validan por separado.
      </p>
    </li>
  );
}

function CountForm({
  handoverId,
  denominations,
  guarantees,
  kind,
  previous,
}: {
  handoverId: string;
  denominations: DenominationOption[];
  guarantees: HandoverCashState['cashGuarantees'];
  kind: 'declarar' | 'confirmar';
  previous: Record<string, number>;
}) {
  const metricStartedAtRef = useRef<HTMLInputElement>(null);
  const currencies = useMemo(() => {
    const map = new Map<string, DenominationOption[]>();
    for (const denomination of denominations) {
      const list = map.get(denomination.currency) ?? [];
      list.push(denomination);
      map.set(denomination.currency, list);
    }
    return [...map.entries()];
  }, [denominations]);

  return (
    <div
      onFocusCapture={() => {
        if (metricStartedAtRef.current && !metricStartedAtRef.current.value) {
          metricStartedAtRef.current.value = String(Date.now());
        }
      }}
    >
      <ActionForm action={kind === 'declarar' ? declareCashCountAction : confirmCashCountAction}>
      <input type="hidden" name="handoverId" value={handoverId} />
      <input ref={metricStartedAtRef} type="hidden" name="metricStartedAt" defaultValue="" />
      <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        Cuenta por denominación exclusivamente el fondo fijo. No incluyas las garantías en este conteo.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {currencies.map(([currency, rows]) => (
          <fieldset key={currency} className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            <legend className="sr-only">Arqueo {currency}</legend>
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm font-semibold text-petrol-900">{currency}</span>
              <span className="text-xs text-slate-500">Cantidad física</span>
            </div>
            {(['BILLETE', 'MONEDA'] as CashMediumValue[]).map((medium) => {
              const mediumRows = rows.filter((row) => row.medium === medium);
              if (mediumRows.length === 0) return null;
              return (
                <div key={medium} className="border-b border-slate-100 last:border-0">
                  <p className="px-3 pt-2 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">
                    {CASH_MEDIUM_LABELS[medium]}
                  </p>
                  <div className="divide-y divide-slate-100">
                    {mediumRows.map((denomination) => (
                      <label
                        key={denomination.id}
                        className="grid grid-cols-[1fr_6.5rem] items-center gap-3 px-3 py-2"
                      >
                        <DenominationVisual
                          currency={currency}
                          value={denomination.value}
                          medium={denomination.medium}
                          compact
                        />
                        <Input
                          name={`d_${denomination.id}`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          defaultValue={previous[denomination.id] ?? ''}
                          placeholder="0"
                          className="h-9 text-right tabular"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>

      <fieldset className="mt-4 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
        <legend className="sr-only">Validación de garantías en efectivo</legend>
        <div className="border-b border-slate-100 bg-gold-50 px-3 py-2">
          <p className="text-sm font-semibold text-petrol-900">Validación de garantías en efectivo</p>
          <p className="mt-0.5 text-xs text-slate-600">
            Confirma físicamente cada garantía vigente. Estas garantías no forman parte del conteo por denominación.
          </p>
        </div>
        {guarantees.length === 0 ? (
          <p className="px-3 py-3 text-sm text-slate-500">No hay garantías en efectivo vigentes que validar.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {guarantees.map((guarantee) => (
              <label
                key={guarantee.id}
                className="flex cursor-pointer items-start gap-3 px-3 py-3 text-sm"
              >
                <input
                  type="checkbox"
                  name={`g_${guarantee.id}`}
                  value="1"
                  required
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-petrol-900">
                    {guarantee.guestName ?? guarantee.reference ?? 'Garantía sin referencia'}
                    {guarantee.roomNumber ? ` · Hab. ${guarantee.roomNumber}` : ''}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {guarantee.currency} {guarantee.amount.toLocaleString('es-CL')}
                    {guarantee.reference ? ` · ${guarantee.reference}` : ''}
                  </span>
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Validar</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <Field
        label="Observaciones del arqueo"
        name="notes"
        hint="Úsalo sólo cuando exista una diferencia que explicar."
      >
        <Textarea name="notes" rows={2} maxLength={500} />
      </Field>

      <SubmitButton pendingLabel="Guardando arqueo…">
        {kind === 'declarar' ? 'Guardar arqueo declarado' : 'Confirmar arqueo recibido'}
      </SubmitButton>
    </ActionForm>
    </div>
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
  const eligible = useMemo(
    () => (kind === 'confirmar' ? elements.filter((element) => element.declared) : elements),
    [elements, kind],
  );
  const [selected, setSelected] = useState<string[]>(
    eligible.filter((element) => element[field]).map((element) => element.id),
  );

  const selectedElements = eligible.filter((element) => selected.includes(element.id));
  const available = eligible.filter((element) => !selected.includes(element.id));

  if (kind === 'confirmar' && eligible.length === 0) {
    return <p className="text-sm text-slate-500">El turno anterior declaró que no entrega elementos físicos.</p>;
  }

  return (
    <ActionForm action={kind === 'declarar' ? declareElementsAction : confirmElementsAction}>
      <input type="hidden" name="handoverId" value={handoverId} />
      {eligible.map((element) => (
        <input
          key={element.id}
          type="hidden"
          name={`e_${element.id}`}
          value={selected.includes(element.id) ? 'true' : 'false'}
        />
      ))}

      <Field
        label={kind === 'declarar' ? 'Agregar elemento' : 'Confirmar elemento recibido'}
        name="elementPicker"
        hint="Selecciona un elemento y se agregará a la lista. Puedes quitarlo antes de guardar."
      >
        <select
          name="elementPicker"
          value=""
          className="input-base"
          onChange={(event) => {
            const id = event.currentTarget.value;
            if (id) setSelected((current) => [...current, id]);
          }}
        >
          <option value="">{available.length ? 'Seleccionar…' : 'No quedan elementos por agregar'}</option>
          {available.map((element) => (
            <option key={element.id} value={element.id}>
              {element.name}
            </option>
          ))}
        </select>
      </Field>

      {selectedElements.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-xl bg-slate-50 ring-1 ring-slate-200">
          {selectedElements.map((element) => (
            <li key={element.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-petrol-900">{element.name}</p>
                {element.detail ? <p className="text-xs text-slate-500">{element.detail}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => setSelected((current) => current.filter((id) => id !== element.id))}
                className="text-xs font-medium text-red-700 hover:underline"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : kind === 'declarar' ? (
        <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <p className="text-sm font-medium text-amber-900">No se entregará ningún elemento.</p>
          <Field
            label="Justificación"
            name="noneJustification"
            required
            hint="Supervisión la revisará, pero esta revisión no bloquea el cierre."
          >
            <Textarea
              name="noneJustification"
              required
              minLength={5}
              maxLength={500}
              rows={2}
              placeholder="Ej.: no hay elementos físicos asignados a este turno."
            />
          </Field>
        </div>
      ) : null}

      <SubmitButton variant="secondary" pendingLabel="Guardando…">
        {kind === 'declarar' ? 'Guardar elementos de entrega' : 'Confirmar elementos recibidos'}
      </SubmitButton>
    </ActionForm>
  );
}

export function CashBox({
  handoverId,
  shiftId,
  state,
  denominations,
  previous,
  role,
  formalClosure,
  canReopen = false,
}: {
  handoverId: string;
  shiftId: string;
  state: HandoverCashState;
  denominations: DenominationOption[];
  previous: Record<string, number>;
  role: 'emisor' | 'receptor' | 'lector';
  formalClosure: {
    closedAt: string;
    closedByName: string;
    reopenedAt: string | null;
  } | null;
  canReopen?: boolean;
}) {
  if (!state.enabled) return null;

  return (
    <Card>
      <CardHeader
        title="Caja del turno"
        action={state.discrepancies.length > 0 ? <Badge tone="atencion">Diferencia entre conteos</Badge> : null}
      />
      <div className="space-y-4 px-4 py-4">
        <p className="text-xs text-slate-500">
          Este es el arqueo formal del turno. Las denominaciones verifican exclusivamente el fondo fijo; las garantías en efectivo se validan una a una en un bloque separado. Los movimientos operacionales y las transferencias mantienen su propia trazabilidad. Fondo fijo:{' '}
          {state.funds.map((fund) => `${fund.currency} ${fund.amount.toLocaleString('es-CL')}`).join(' · ')}.
          Estos fondos se configuran desde Administración → Parámetros.
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
          <h3 className="text-sm font-semibold text-petrol-900">Garantías en efectivo bajo custodia</h3>
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
                      {guarantee.guestName ?? guarantee.reference ?? 'Garantía sin referencia'}
                      {guarantee.roomNumber ? ` · Hab. ${guarantee.roomNumber}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {guarantee.reference ? `${guarantee.reference} · ` : ''}
                      {guarantee.state.toLowerCase().replaceAll('_', ' ')}
                      {guarantee.dueAt ? ` · objetivo ${new Date(guarantee.dueAt).toLocaleString('es-CL')}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="font-semibold tabular text-petrol-900">
                      {guarantee.currency} {guarantee.amount.toLocaleString('es-CL')}
                    </span>
                    {role !== 'lector' ? (
                      <ReturnCashGuaranteeForm
                        guaranteeId={guarantee.id}
                        reference={guarantee.reference ?? guarantee.guestName}
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-slate-500">
            El monto mostrado es el saldo reembolsable todavía bajo custodia. Durante el arqueo cada garantía vigente debe validarse físicamente por separado; nunca se suma al conteo por denominación del fondo fijo.
          </p>
        </section>

        {state.elements.length > 0 ? (
          <section>
            <h3 className="text-sm font-semibold text-petrol-900">Elementos físicos</h3>
            {role === 'lector' ? (
              <ul className="mt-1 space-y-1 text-sm">
                {state.elements.map((element) => (
                  <li key={element.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-petrol-900">{element.name}</span>
                    <Badge tone={element.declared ? 'resuelto' : 'neutro'}>{element.declared ? 'Declarado' : 'No entregado'}</Badge>
                    {element.declared ? (
                      <Badge tone={element.confirmed ? 'resuelto' : 'neutro'}>{element.confirmed ? 'Recibido' : 'Sin confirmar'}</Badge>
                    ) : null}
                    {!element.declared && element.notes ? <span className="text-xs text-slate-500">{element.notes}</span> : null}
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
            <h3 className="text-sm font-semibold text-petrol-900">Transferencias a Tesorería</h3>
            <ul className="mt-1 space-y-1 text-sm text-slate-600">
              {state.transfers.map((transfer) => (
                <li key={transfer.id} className="flex flex-wrap items-center gap-2 tabular">
                  <span>
                    {transfer.currency} {transfer.amount.toLocaleString('es-CL')}
                    {transfer.reference ? ` · comprobante ${transfer.reference}` : ''} · {transfer.createdByName}
                  </span>
                  <Badge tone={transfer.approved ? 'resuelto' : 'pendiente'}>
                    {transfer.approved ? 'Revisado por Supervisión' : 'Pendiente de revisión'}
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
              guarantees={state.cashGuarantees}
              kind={role === 'emisor' ? 'declarar' : 'confirmar'}
              previous={previous}
            />
          </div>
        ) : null}

        {role === 'emisor' && state.declared ? (
          <section className="rounded-xl bg-gold-50 p-3 ring-1 ring-gold-200 no-print">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-petrol-900">
                  {formalClosure && !formalClosure.reopenedAt ? 'Caja cerrada' : 'Cerrar Caja'}
                </h3>
                {formalClosure && !formalClosure.reopenedAt ? (
                  <p className="mt-1 text-xs text-emerald-800">
                    Cerrada por {formalClosure.closedByName} · {new Date(formalClosure.closedAt).toLocaleString('es-CL')}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-600">
                    El arqueo y las garantías quedarán congelados para la entrega de turno.
                  </p>
                )}
              </div>
              {formalClosure && !formalClosure.reopenedAt ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="resuelto">CAJA CERRADA</Badge>
                  {canReopen ? (
                    <ActionForm action={reopenShiftCashAction} className="space-y-0" refreshOnSuccess>
                      <input type="hidden" name="shiftId" value={shiftId} />
                      <input
                        type="hidden"
                        name="reason"
                        value="Reapertura manual de Caja desde el cierre de turno."
                      />
                      <SubmitButton variant="secondary" pendingLabel="Abriendo Caja…">
                        ABRIR CAJA
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              ) : (
                <ActionForm action={closeShiftCashAction} className="space-y-0" refreshOnSuccess>
                  <input type="hidden" name="shiftId" value={shiftId} />
                  <SubmitButton variant="gold" pendingLabel="Cerrando Caja…">
                    CERRAR CAJA
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </section>
        ) : null}

        {role === 'emisor' ? (
          <>
            <div className="border-t border-slate-100 pt-3 no-print">
              <h3 className="mb-2 text-sm font-semibold text-petrol-900">Dólar operativo</h3>
              <ActionForm action={saveHandoverUsdRateAction}>
                <input type="hidden" name="handoverId" value={handoverId} />
                <Field
                  label="USD 1 = CLP"
                  name="usdRateCLP"
                  hint="Escribe pesos enteros. El campo no cambia con la rueda del ratón ni agrega decimales."
                >
                  <div className="relative max-w-xs">
                    <span className="pointer-events-none absolute left-3 top-2.5 text-sm font-medium text-slate-500">CLP</span>
                    <Input
                      name="usdRateCLP"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      placeholder="950"
                      className="pl-12 text-right text-lg font-semibold tabular"
                    />
                  </div>
                </Field>
                <SubmitButton variant="secondary" pendingLabel="Guardando…">Guardar dólar</SubmitButton>
              </ActionForm>
            </div>

            <div className="border-t border-slate-100 pt-3 no-print">
              <h3 className="mb-1 text-sm font-semibold text-petrol-900">Transferencia interna a Tesorería</h3>
              <p className="mb-2 text-xs text-slate-500">
                Mueve efectivo desde Recepción a Tesorería; no es un gasto. Sólo permite transferir saldo operacional disponible: nunca fondo fijo ni garantías bajo custodia. Todo monto mayor que 0 genera trazabilidad y revisión según la política vigente.
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
                <SubmitButton variant="secondary" pendingLabel="Registrando…">Registrar transferencia</SubmitButton>
              </ActionForm>
            </div>
          </>
        ) : null}
      </div>
    </Card>
  );
}
