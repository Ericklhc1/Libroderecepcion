'use client';

import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import {
  confirmCashCountAction,
  confirmElementsAction,
  declareCashCountAction,
  declareElementsAction,
  recordCashTransferAction,
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

/** Semáforo del fondo fijo: nunca sólo color, siempre texto. */
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
        contado {formatMinor(status.countedMinor, status.currency)} · fondo{' '}
        {formatMinor(status.fundMinor, status.currency)}
      </span>
      {status.balanced ? (
        <Badge tone="resuelto">Cuadra</Badge>
      ) : status.shortfallMinor > 0 ? (
        <Badge tone="atencion">
          Falta {formatMinor(status.shortfallMinor, status.currency)}
        </Badge>
      ) : (
        <Badge tone="pendiente">
          Sobra {formatMinor(status.surplusMinor, status.currency)} · a tesorería
        </Badge>
      )}
    </li>
  );
}

/**
 * Arqueo por denominación.
 *
 * Se cuenta billete por billete, no un total: así el conteo es verificable y
 * el fondo fijo se reconstruye exacto. Los campos se llaman `d_<id>` porque un
 * formulario no puede enviar un objeto.
 */
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
    <ActionForm
      action={kind === 'declarar' ? declareCashCountAction : confirmCashCountAction}
    >
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

      <Field
        label="Observaciones del arqueo"
        name="notes"
        hint="Obligatorio si la caja no coincide con el fondo fijo."
      >
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
    <ActionForm
      action={kind === 'declarar' ? declareElementsAction : confirmElementsAction}
    >
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
              {element.required ? null : (
                <span className="ml-1 text-xs text-slate-400">(opcional)</span>
              )}
              {element.detail ? (
                <span className="block text-xs text-slate-500">{element.detail}</span>
              ) : null}
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
  /** Cantidades del arqueo que corresponde a este rol, para no recontar de cero. */
  previous: Record<string, number>;
  /** `emisor` cuenta y declara; `receptor` recuenta y confirma; `lector` sólo mira. */
  role: 'emisor' | 'receptor' | 'lector';
}) {
  if (!state.enabled) return null;

  return (
    <Card>
      <CardHeader
        title="Caja, fondo fijo y elementos"
        action={
          state.discrepancies.length > 0 ? (
            <Badge tone="atencion">Diferencia entre los dos conteos</Badge>
          ) : null
        }
      />
      <div className="space-y-4 px-4 py-4">
        {/*
          El fondo fijo es lo que SIEMPRE queda en el cajón: no es recaudación
          y no se entrega a tesorería. Lo que sobra sí.
        */}
        <p className="text-xs text-slate-500">
          Fondo fijo:{' '}
          {state.funds
            .map((fund) => `${fund.currency} ${fund.amount.toLocaleString('es-CL')}`)
            .join(' · ')}
          . Lo que exceda ese monto es recaudación del turno y sale como egreso a tesorería.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-petrol-900">Declarado al entregar</h3>
            {state.declared ? (
              <>
                <p className="mt-0.5 text-xs text-slate-500">
                  {state.declared.countedByName} ·{' '}
                  {state.declared.countedAt.toLocaleString('es-CL')}
                </p>
                <ul className="mt-1 divide-y divide-slate-100">
                  {state.declared.statuses.map((status) => (
                    <FundRow key={status.currency} status={status} />
                  ))}
                </ul>
                {state.declared.notes ? (
                  <p className="mt-1 text-xs text-slate-600">{state.declared.notes}</p>
                ) : null}
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
                  {state.confirmed.countedByName} ·{' '}
                  {state.confirmed.countedAt.toLocaleString('es-CL')}
                </p>
                <ul className="mt-1 divide-y divide-slate-100">
                  {state.confirmed.statuses.map((status) => (
                    <FundRow key={status.currency} status={status} />
                  ))}
                </ul>
                {state.confirmed.notes ? (
                  <p className="mt-1 text-xs text-slate-600">{state.confirmed.notes}</p>
                ) : null}
              </>
            ) : (
              <EmptyState message="Pendiente de recuento por quien recibe." />
            )}
          </section>
        </div>

        {state.discrepancies.length > 0 ? (
          <div className="rounded-lg bg-orange-50 p-3 ring-1 ring-orange-200">
            <p className="text-sm font-semibold text-orange-900">
              Los dos conteos no coinciden
            </p>
            <ul className="mt-1 space-y-0.5 text-sm text-orange-800">
              {state.discrepancies.map((row) => (
                <li key={row.currency} className="tabular">
                  {row.currency}: se declararon{' '}
                  {formatMinor(row.declaredMinor, row.currency)} y se contaron{' '}
                  {formatMinor(row.confirmedMinor, row.currency)} (
                  {row.differenceMinor > 0 ? '+' : ''}
                  {fromMinor(row.differenceMinor, row.currency).toLocaleString('es-CL')})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.elements.length > 0 ? (
          <section>
            <h3 className="text-sm font-semibold text-petrol-900">Elementos</h3>
            {role === 'lector' ? (
              <ul className="mt-1 space-y-1 text-sm">
                {state.elements.map((element) => (
                  <li key={element.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-petrol-900">{element.name}</span>
                    <Badge tone={element.declared ? 'resuelto' : 'neutro'}>
                      {element.declared ? 'Declarado' : 'Sin declarar'}
                    </Badge>
                    <Badge tone={element.confirmed ? 'resuelto' : 'neutro'}>
                      {element.confirmed ? 'Recibido' : 'Sin confirmar'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1">
                <ElementsForm
                  handoverId={handoverId}
                  elements={state.elements}
                  kind={role === 'emisor' ? 'declarar' : 'confirmar'}
                />
              </div>
            )}
          </section>
        ) : null}

        {state.openGuarantees > 0 ? (
          <p className="text-sm text-slate-600">
            {/* Se ENLAZA lo que ya existe en garantías: no se duplica acá. */}
            Hay{' '}
            <a href="/supervision" className="font-medium text-petrol-600 hover:underline">
              {state.openGuarantees} garantía(s) por resolver
            </a>{' '}
            que pasan al turno siguiente.
          </p>
        ) : null}

        {state.transfers.length > 0 ? (
          <section>
            <h3 className="text-sm font-semibold text-petrol-900">Egresos a tesorería</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
              {state.transfers.map((transfer) => (
                <li key={transfer.id} className="tabular">
                  {transfer.currency} {transfer.amount.toLocaleString('es-CL')}
                  {transfer.reference ? ` · comprobante ${transfer.reference}` : ''} ·{' '}
                  {transfer.createdByName}
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
          <div className="border-t border-slate-100 pt-3 no-print">
            <h3 className="mb-2 text-sm font-semibold text-petrol-900">
              Registrar egreso a tesorería
            </h3>
            <ActionForm action={recordCashTransferAction}>
              <input type="hidden" name="handoverId" value={handoverId} />
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Divisa" name="currency" required>
                  <Input name="currency" defaultValue="CLP" maxLength={3} required />
                </Field>
                <Field label="Monto" name="amount" required>
                  <Input name="amount" type="number" min={1} step="0.01" required />
                </Field>
                <Field label="Comprobante" name="reference">
                  <Input name="reference" maxLength={60} placeholder="SOBRE-0912" />
                </Field>
              </div>
              <SubmitButton variant="secondary" pendingLabel="Registrando…">
                Registrar egreso
              </SubmitButton>
            </ActionForm>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
