import Link from 'next/link';
import {
  ClipboardCheck,
  KeyRound,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { ActionForm, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { LiveCashAuditDialog } from '@/components/cash/live-cash-forms';
import { SupervisionAuditUpload } from '@/components/supervision/audit-upload';
import { completeSupervisionOpeningAction } from '@/server/actions/supervision-center';
import type { SupervisionOpeningReadiness } from '@/server/services/supervision-center';
import { formatDateTime } from '@/lib/format';

function keyTone(missing: number, outOfService: number) {
  return missing > 0 || outOfService > 0 ? 'pendiente' : 'resuelto';
}

export function SupervisionOpeningPanel({
  readiness,
}: {
  readiness: SupervisionOpeningReadiness;
}) {
  const cashBlocked = readiness.blockers.cash > 0;
  const reportsIncomplete = !readiness.reports.reportsReady;
  const blocked = cashBlocked;

  return (
    <section id="apertura-supervision" className="space-y-4">
      <Card>
        <CardHeader
          title="Apertura operacional de Supervisión"
          action={<Badge tone="pendiente">Preparación</Badge>}
        />
        <div className="space-y-3 px-4 py-4">
          <div className="flex gap-3 rounded-xl bg-gold-50 px-3 py-3 ring-1 ring-gold-200">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold-700" aria-hidden="true" />
            <div>
              <p className="font-medium text-petrol-900">Tu turno todavía no está activo.</p>
              <p className="mt-0.5 text-sm text-slate-600">
                Primero recibes la operación: pendientes, Caja, garantías, llaves e informes.
                Sólo después el Libro registra formalmente que asumiste Supervisión.
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Pendientes visibles</p>
              <p className="text-lg font-semibold text-petrol-900">{readiness.pendingTotal}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Caja</p>
              <p className="text-lg font-semibold text-petrol-900">
                {readiness.cash.currencies.length - readiness.cash.missingCurrencies.length}/{readiness.cash.currencies.length}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Garantías abiertas</p>
              <p className="text-lg font-semibold text-petrol-900">{readiness.guarantees.length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Evidencia PMS</p>
              <p className="text-lg font-semibold text-petrol-900">
                {readiness.reports.reportsReady ? 'Completa' : 'Pendiente'}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="1 · Estado operativo recibido"
          action={
            readiness.pendingTotal > 0
              ? <Badge tone="pendiente">{readiness.pendingTotal} asunto(s)</Badge>
              : <Badge tone="resuelto">Sin pendientes</Badge>
          }
        />
        {readiness.pendingRows.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-600">
            No hay señales, tareas ni seguimientos abiertos que debas recibir en este momento.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto border-t border-slate-100">
            <ul className="divide-y divide-slate-100">
              {readiness.pendingRows.map((row) => (
                <li key={row.key} className="flex items-start gap-3 px-4 py-3">
                  <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-petrol-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-slate-500">{row.ref}</span>
                      <Chip>{row.group}</Chip>
                    </div>
                    <p className="mt-1 text-sm font-medium text-petrol-900">{row.title}</p>
                    {row.detail ? <p className="mt-0.5 text-xs text-slate-600">{row.detail}</p> : null}
                  </div>
                  <Link href={row.href} className="shrink-0 text-xs font-semibold text-petrol-700 hover:underline">
                    Revisar
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Al iniciar, el Libro fotografía estos asuntos y construye tus prioridades desde fuentes reales.
          No crea una segunda tarea ni una copia de la novedad.
        </p>
      </Card>

      <Card>
        <CardHeader title="2 · Caja y garantías" />
        <div className="space-y-4 px-4 py-4">
          <p className="text-sm text-slate-600">
            El Supervisor hace un arqueo propio por cada fondo activo. Las garantías en efectivo se
            validan físicamente dentro de ese arqueo; si cambian después, el arqueo deja de servir para la apertura.
          </p>

          {readiness.cash.currencies.length === 0 ? (
            <p className="text-sm text-slate-600">Caja no está habilitada en la configuración del hotel.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {readiness.cash.currencies.map((cash) => {
                const guarantees = readiness.cash.guarantees.filter(
                  (guarantee) => guarantee.currency.toUpperCase() === cash.currency,
                );
                const denominations = readiness.cash.denominations.filter(
                  (denomination) => denomination.currency.toUpperCase() === cash.currency,
                );

                return (
                  <div key={cash.currency} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <WalletCards className="h-4 w-4 text-petrol-600" aria-hidden="true" />
                          <p className="font-semibold text-petrol-900">Caja {cash.currency}</p>
                          <Badge tone={cash.ready ? 'resuelto' : 'critico'}>
                            {cash.ready ? 'Conforme' : 'Pendiente'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Fondo fijo: {cash.currency} {cash.fund.toLocaleString('es-CL')}
                        </p>
                        {cash.audit ? (
                          <p className="mt-1 text-xs text-slate-600">
                            Contado {cash.currency} {cash.audit.countedAmount.toLocaleString('es-CL')}
                            {' · '}diferencia {cash.currency} {cash.audit.difference.toLocaleString('es-CL')}
                            {' · '}{formatDateTime(cash.audit.createdAt)}
                          </p>
                        ) : null}
                      </div>
                      <LiveCashAuditDialog
                        currency={cash.currency}
                        fund={cash.fund}
                        denominations={denominations}
                        guarantees={guarantees}
                      />
                    </div>
                    {!cash.fundCurrent && cash.audit ? (
                      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                        El fondo fijo cambió desde este arqueo. Debes volver a contarlo.
                      </p>
                    ) : null}
                    {!cash.guaranteesCurrent && cash.audit ? (
                      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                        Las garantías vigentes cambiaron desde este arqueo. Debes volver a validarlas.
                      </p>
                    ) : null}
                    {cash.audit?.difference !== 0 && !cash.audit?.notes?.trim() ? (
                      <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-200">
                        La diferencia del arqueo debe quedar explicada antes de iniciar Supervisión.
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-500">
                      {guarantees.length} garantía(s) en efectivo se validan físicamente por separado.
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-petrol-900">Garantías y custodias abiertas</p>
                <p className="text-xs text-slate-500">
                  Las garantías no se duplican: aquí ves el estado vigente de su fuente original.
                </p>
              </div>
              <Badge tone={readiness.guarantees.length > 0 ? 'pendiente' : 'resuelto'}>
                {readiness.guarantees.length}
              </Badge>
            </div>
            {readiness.guarantees.length > 0 ? (
              <div className="mt-3 max-h-52 overflow-y-auto">
                <ul className="divide-y divide-slate-200 text-sm">
                  {readiness.guarantees.map((guarantee) => (
                    <li key={guarantee.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-petrol-900">
                        #{guarantee.humanId} · {guarantee.guestName ?? guarantee.reference ?? 'Sin referencia'}
                        {guarantee.roomNumber ? ` · Hab. ${guarantee.roomNumber}` : ''}
                      </span>
                      <span className="text-xs tabular text-slate-500">
                        {guarantee.currency} {guarantee.amount.toLocaleString('es-CL')} · {guarantee.kind.toLocaleLowerCase('es-CL')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="3 · Llaves y elementos críticos" />
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-3">
          {readiness.keys.map((row) => (
            <div key={row.floor} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-medium text-petrol-900">
                  <KeyRound className="h-4 w-4 text-petrol-600" aria-hidden="true" />
                  Piso {row.floor}
                </p>
                <Badge tone={keyTone(row.totals.missing, row.totals.outOfService)}>
                  {row.id ? `${row.totals.found}/${row.totals.expected}` : 'Sin inventario'}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Faltantes: {row.totals.missing} · Fuera de servicio: {row.totals.outOfService}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {row.countedAt
                  ? `Último inventario: ${formatDateTime(row.countedAt)} · ${row.countedBy ?? 'sin usuario'}`
                  : 'Sin inventario registrado.'}
              </p>
            </div>
          ))}
        </div>
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          No se repite un conteo de 89 llaves por burocracia: revisas el último inventario y sus excepciones.
          Un faltante permanece visible y debe gestionarse, pero no se maquilla con una confirmación genérica.
        </p>
      </Card>

      <Card>
        <CardHeader
          title="4 · Informes PMS"
          action={
            readiness.reports.reportsReady
              ? <Badge tone="resuelto">Evidencia operativa completa</Badge>
              : <Badge tone="pendiente">Evidencia incompleta</Badge>
          }
        />
        <div className="space-y-5 px-4 py-4">
          <div className="rounded-xl bg-petrol-50 p-3 ring-1 ring-petrol-100">
            <p className="text-sm font-semibold text-petrol-900">
              Fotografía operacional de hoy · {readiness.businessDateKey}
            </p>
            <p className="mt-1 text-xs text-petrol-800">
              Preferido: <strong>{readiness.reports.labels[readiness.reports.operationalPrimary]}</strong>.
              Ese informe ya reúne entradas, ocupadas y salidas. Si no está disponible,
              el respaldo válido es Entradas + In House + Salidas.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={readiness.reports.todayKinds.includes(readiness.reports.operationalPrimary) ? 'resuelto' : 'neutro'}>
                {readiness.reports.todayKinds.includes(readiness.reports.operationalPrimary) ? '✓ ' : '○ '}
                {readiness.reports.labels[readiness.reports.operationalPrimary]}
              </Badge>
              <span className="self-center text-xs text-slate-500">o</span>
              {readiness.reports.operationalFallback.map((kind: string) => (
                <Badge key={kind} tone={readiness.reports.todayKinds.includes(kind) ? 'resuelto' : 'neutro'}>
                  {readiness.reports.todayKinds.includes(kind) ? '✓ ' : '○ '}
                  {readiness.reports.labels[kind] ?? kind}
                </Badge>
              ))}
            </div>
            {!readiness.reports.occupancyReady ? (
              <p className="mt-2 text-xs text-amber-800">
                Falta la fotografía operacional de hoy.
              </p>
            ) : null}

            {readiness.reports.pmsProcessing.rows.length > 0 ? (
              <div className="mt-3 rounded-lg bg-white p-3 ring-1 ring-petrol-100">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={readiness.reports.pmsProcessing.pending > 0 ? 'pendiente' : 'resuelto'}>
                    {readiness.reports.pmsProcessing.pending} pendiente(s) según enlace
                  </Badge>
                  <Badge tone="neutro">
                    {readiness.reports.pmsProcessing.processedProbable} procesado(s) probable(s)
                  </Badge>
                  {readiness.reports.pmsProcessing.unknown > 0 ? (
                    <Badge tone="neutro">
                      {readiness.reports.pmsProcessing.unknown} sin señal visual
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Esta lectura usa la anotación de enlace del ID FNS como evidencia. No confirma
                  automáticamente check-in ni check-out; sirve para dirigir la revisión del turno.
                </p>
                <div className="mt-2 max-h-44 overflow-y-auto">
                  <ul className="divide-y divide-slate-100 text-xs">
                    {readiness.reports.pmsProcessing.rows.map((row) => (
                      <li key={`${row.reservationId}:${row.status}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="font-medium text-petrol-900">
                          {row.status === 'CHECK_IN' ? 'Entrada' : 'Salida'} · ID {row.reservationId}
                          {row.roomNumber ? ` · Hab. ${row.roomNumber}` : ''}
                        </span>
                        <span className="text-slate-500">
                          {row.signal === 'PENDIENTE'
                            ? 'Pendiente · confianza alta'
                            : row.signal === 'PROCESADO_PROBABLE'
                              ? 'Procesado probable · verificar'
                              : 'Sin señal'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-petrol-900">Continuidad desde el cierre anterior</p>
                <p className="mt-1 text-xs text-slate-600">
                  La apertura toma el relevo formal del último turno de Recepción cerrado. Los informes
                  históricos siguen disponibles como evidencia, pero no se mezclan como si fueran el
                  dashboard de la jornada actual.
                </p>
              </div>
              <Badge tone={readiness.reports.previousClosure?.ready ? 'resuelto' : 'pendiente'}>
                {readiness.reports.previousClosure?.ready ? 'Cierre recibido' : 'Cierre pendiente'}
              </Badge>
            </div>
            {readiness.reports.previousClosure ? (
              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
                <p className="font-medium text-petrol-900">
                  Turno #{readiness.reports.previousClosure.humanId} · {readiness.reports.previousClosure.type}
                  {' · '}{readiness.reports.previousClosure.businessDate}
                </p>
                <p className="mt-1">
                  Entrega: {readiness.reports.previousClosure.handoverStatus ?? 'sin entrega'}
                  {' · '}validación posterior: {
                    readiness.reports.previousClosure.validationStatus === 'RESUELTA'
                      ? 'validada'
                      : readiness.reports.previousClosure.validationStatus
                        ? 'pendiente'
                        : 'sin registro'
                  }.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-amber-800">
                No se encontró un turno de Recepción cerrado anterior a esta apertura.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="font-medium text-petrol-900">Subir informes</p>
            <p className="mt-1 text-xs text-slate-500">
              Puedes seleccionar varios PDF. La fecha de origen se conserva para trazabilidad, pero
              el tablero operativo muestra sólo la jornada que estás gestionando.
            </p>
            <div className="mt-3">
              <SupervisionAuditUpload
                defaultBusinessDate={readiness.businessDateKey}
                automaticBusinessDate
              />
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-200">
            <p className="font-semibold text-slate-700">Gestión · no bloquea la apertura</p>
            <p className="mt-1">
              Ventas por período del mes actual, Producción por habitación y Revenue quedan como compromisos del turno
              si todavía faltan. Pendientes:{' '}
              {readiness.reports.missingOptional.length
                ? readiness.reports.missingOptional
                    .map((kind: string) => readiness.reports.labels[kind] ?? kind)
                    .join(', ')
                : 'ninguno'}.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="5 · Confirmar recepción e iniciar" />
        <div className="space-y-4 px-4 py-4">
          {cashBlocked ? (
            <div className="rounded-xl bg-red-50 px-3 py-3 text-sm text-red-900 ring-1 ring-red-200">
              <p className="font-semibold">Caja/garantías todavía no están conformes.</p>
              {readiness.cash.missingCurrencies.length > 0 ? (
                <p className="mt-1">Falta tu arqueo o validación vigente: {readiness.cash.missingCurrencies.join(', ')}.</p>
              ) : null}
              {readiness.cash.unexplainedDifferences.length > 0 ? (
                <p className="mt-1">
                  Hay diferencias sin explicación: {readiness.cash.unexplainedDifferences.join(', ')}.
                </p>
              ) : null}

            </div>
          ) : null}

          <ActionForm action={completeSupervisionOpeningAction} refreshOnSuccess className="space-y-3">
            <input type="hidden" name="shiftId" value={readiness.shift.id} />

            <label className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
              <input type="checkbox" name="reviewedPending" required className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Revisé los asuntos pendientes, señales, tareas y seguimientos que recibo al comenzar.</span>
            </label>

            <label className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
              <input type="checkbox" name="reviewedGuarantees" required className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Verifiqué las garantías y custodias abiertas; las garantías en efectivo fueron validadas físicamente en mi arqueo.
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
              <input type="checkbox" name="reviewedKeys" required className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Revisé el último inventario de llaves y conozco sus faltantes o excepciones vigentes.</span>
            </label>

            {reportsIncomplete ? (
              <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                <p className="text-sm font-semibold text-amber-950">Contingencia de PMS / informes</p>
                <p className="mt-1 text-xs text-amber-900">
                  No se bloquea la Supervisión por una falla externa del PMS. Para continuar sin
                  evidencia completa debes dejar el motivo; quedará guardado en la apertura.
                </p>
                <Textarea
                  name="reportContingencyReason"
                  rows={3}
                  minLength={8}
                  required
                  placeholder="Ej.: PMS sin disponibilidad desde las 07:05; informe pendiente de emisión."
                />
              </div>
            ) : null}

            <div className="flex justify-end">
              <SubmitButton variant="gold" pendingLabel="Iniciando turno…" disabled={blocked}>
                CONFIRMAR E INICIAR SUPERVISIÓN
              </SubmitButton>
            </div>
          </ActionForm>
        </div>
      </Card>
    </section>
  );
}
