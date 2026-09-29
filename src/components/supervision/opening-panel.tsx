import Link from 'next/link';
import { AlertTriangle, Banknote, CheckCircle2, KeyRound, ListChecks } from 'lucide-react';
import { ActionForm, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { LiveCashAuditDialog } from '@/components/cash/live-cash-forms';
import { SupervisionAuditUpload } from '@/components/supervision/audit-upload';
import { completeSupervisionOpeningAction } from '@/server/actions/supervision-center';
import { calendarDateKey } from '@/domain/time';
import { SUPERVISION_REPORT_LABELS } from '@/domain/supervision-opening';
import type { SupervisionBlock } from '@/server/services/supervision';
import type { LiveCashState } from '@/server/services/live-cash';
import type { getSupervisionOpeningState } from '@/server/services/supervision-center';

type OpeningState = Awaited<ReturnType<typeof getSupervisionOpeningState>>;

function money(currency: string, value: number | null) {
  if (value === null) return '—';
  return `${currency} ${value.toLocaleString('es-CL', { maximumFractionDigits: currency === 'USD' ? 2 : 0 })}`;
}

export function SupervisionOpeningPanel({
  opening,
  blocks,
  cashState,
}: {
  opening: OpeningState;
  blocks: SupervisionBlock[];
  cashState: LiveCashState;
}) {
  const today = calendarDateKey(opening.today);
  const auditDate = calendarDateKey(opening.auditDate);
  const pendingRows = blocks.flatMap((block) =>
    block.rows.map((row) => ({ ...row, blockTitle: block.title })),
  );

  return (
    <section id="apertura-supervision" className="space-y-4">
      <Card>
        <CardHeader title="Apertura de Supervisión" action={<Badge tone="pendiente">Preparación</Badge>} />
        <div className="space-y-3 px-4 py-4">
          <p className="text-sm text-slate-700">
            Tu turno todavía no está activo. La apertura confirma qué operación recibes,
            comprueba Caja y garantías, revisa llaves y carga la evidencia del PMS antes
            de registrar formalmente el inicio.
          </p>
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Caja y garantías</p>
              <p className="mt-1 font-semibold text-petrol-900">{opening.cashReady ? '✓ Conforme' : 'Pendiente'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Informes operativos</p>
              <p className="mt-1 font-semibold text-petrol-900">{opening.reports.reportsReady ? '✓ Completos' : 'Pendientes'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Señales por revisar</p>
              <p className="mt-1 font-semibold text-petrol-900">{pendingRows.length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Inventarios de hoy</p>
              <p className="mt-1 font-semibold text-petrol-900">{opening.keys.filter((row) => row.freshToday).length}/3 pisos</p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="1 · Estado operativo recibido" count={pendingRows.length} />
        <div className="px-4 pb-4">
          {pendingRows.length === 0 ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
              No hay señales abiertas que el Centro de Supervisión marque para revisión.
            </p>
          ) : (
            <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200">
              {pendingRows.map((row) => (
                <div key={`${row.blockTitle}:${row.id}`} className="flex items-start gap-3 px-3 py-3">
                  <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-petrol-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-500">{row.blockTitle}</p>
                    <p className="text-sm font-medium text-petrol-900">{row.ref ? `${row.ref} · ` : ''}{row.title}</p>
                    {row.detail ? <p className="mt-0.5 text-xs text-slate-600">{row.detail}</p> : null}
                  </div>
                  <Link href={row.href} className="shrink-0 text-xs font-semibold text-petrol-700 hover:underline">
                    Gestionar
                  </Link>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Esta lista se vuelve a capturar al confirmar la apertura; no se duplica como tareas nuevas.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="2 · Caja y garantías" />
        <div className="space-y-3 px-4 pb-4">
          <p className="text-sm text-slate-600">
            El Supervisor hace su propio arqueo. Las garantías en efectivo se validan físicamente,
            una por una, dentro del mismo arqueo.
          </p>
          {opening.cash.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
              Caja no está habilitada porque no hay fondos fijos activos.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {opening.cash.map((row) => {
                const denoms = cashState.denominations
                  .filter((item) => item.currency === row.currency)
                  .map((item) => ({ id: item.id, value: item.value, medium: item.medium }));
                const guarantees = cashState.cashGuarantees
                  .filter((item) => item.currency === row.currency)
                  .map((item) => ({
                    id: item.id,
                    amount: item.amount,
                    guestName: item.guestName,
                    roomNumber: item.roomNumber,
                    reference: item.reference,
                  }));
                return (
                  <div key={row.currency} className="rounded-xl p-3 ring-1 ring-slate-200">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 font-semibold text-petrol-900">
                          <Banknote className="h-4 w-4" aria-hidden="true" /> {row.currency}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Fondo {money(row.currency, row.fund)} · {row.guaranteeCount} garantía(s)
                        </p>
                      </div>
                      <Badge tone={row.ready ? 'resuelto' : 'pendiente'}>{row.ready ? 'Validado' : 'Pendiente'}</Badge>
                    </div>
                    {row.auditId ? (
                      <p className="mt-2 text-xs text-slate-600">
                        Contado {money(row.currency, row.counted)} · diferencia {money(row.currency, row.difference)}
                        {!row.guaranteesCurrent ? ' · las garantías cambiaron y debes recontar' : ''}
                      </p>
                    ) : null}
                    <div className="mt-3">
                      <LiveCashAuditDialog currency={row.currency} fund={row.fund} denominations={denoms} guarantees={guarantees} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="3 · Llaves" />
        <div className="space-y-3 px-4 pb-4">
          <p className="text-sm text-slate-600">
            No se obliga al Supervisor a volver a contar 89 llaves si Recepción ya tomó inventario:
            sí debe revisar el inventario vigente y cualquier excepción antes de asumir.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {opening.keys.map((row) => (
              <div key={row.floor} className="rounded-xl p-3 ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 font-medium text-petrol-900">
                    <KeyRound className="h-4 w-4" aria-hidden="true" /> Piso {row.floor}
                  </p>
                  <Badge tone={row.missing > 0 ? 'critico' : row.freshToday ? 'resuelto' : 'pendiente'}>
                    {row.countId ? `${row.found}/${row.expected}` : 'Sin inventario'}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {row.countedAt ? (row.freshToday ? 'Tomado hoy' : 'Inventario anterior') : 'Sin inventario registrado'}
                  {row.countedBy ? ` · ${row.countedBy}` : ''}
                </p>
                {row.missing > 0 ? <p className="mt-1 text-xs font-medium text-red-700">{row.missing} faltante(s).</p> : null}
              </div>
            ))}
          </div>
          <Link href="/libro" className="inline-flex text-sm font-semibold text-petrol-700 hover:underline">
            Abrir inventario de llaves
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeader title="4 · Informes PMS del inicio del día" />
        <div className="space-y-5 px-4 pb-4">
          <div className="rounded-xl bg-petrol-50 p-3 text-sm text-petrol-900 ring-1 ring-petrol-100">
            <p className="font-semibold">Fotografía operativa actual · {today}</p>
            <p className="mt-1 text-xs">
              Preferido: <strong>Habitaciones con actividad</strong>. Ya contiene entradas, ocupadas y salidas;
              no tiene sentido exigir además los tres informes antiguos. Si no está disponible,
              el respaldo válido es Entradas + In House + Salidas.
            </p>
            <p className="mt-2 text-xs">Estado: {opening.reports.occupancyReady ? '✓ completo' : 'pendiente'}.</p>
          </div>
          <SupervisionAuditUpload defaultBusinessDate={today} />

          <div className="border-t border-slate-200 pt-4">
            <p className="font-semibold text-petrol-900">Cierre y auditoría · {auditDate}</p>
            <p className="mt-1 text-sm text-slate-600">
              Para la apertura se exigen Formulario de auditoría, Cobros y Cargos diarios.
            </p>
            {opening.reports.missingAudit.length > 0 ? (
              <p className="mt-2 flex items-start gap-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Faltan: {opening.reports.missingAudit.map((kind) => SUPERVISION_REPORT_LABELS[kind] ?? kind).join(', ')}.
              </p>
            ) : (
              <p className="mt-2 flex items-center gap-2 text-xs text-emerald-800">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Evidencia obligatoria completa.
              </p>
            )}
            <div className="mt-3">
              <SupervisionAuditUpload defaultBusinessDate={auditDate} />
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-200">
            <p className="font-semibold text-slate-700">Gestión, no bloqueo</p>
            <p className="mt-1">
              Ventas por canal, Producción por habitación y Revenue siguen siendo requeridos para gestión diaria,
              pero no impiden abrir el turno. Pendientes: {opening.reports.missingManagement.length
                ? opening.reports.missingManagement.map((kind) => SUPERVISION_REPORT_LABELS[kind] ?? kind).join(', ')
                : 'ninguno'}.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="5 · Confirmar recepción e iniciar" />
        <ActionForm action={completeSupervisionOpeningAction} className="space-y-3 px-4 pb-4" refreshOnSuccess>
          <input type="hidden" name="shiftId" value={opening.shift.id} />

          <label className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
            <input type="checkbox" name="reviewedPending" required className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Revisé los {pendingRows.length} asunto(s) visibles que recibo y conozco cuáles requieren gestión o seguimiento.</span>
          </label>

          <label className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
            <input type="checkbox" name="reviewedKeys" required className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Revisé el inventario de llaves y las excepciones visibles de los pisos 4, 5 y 6.</span>
          </label>

          {!opening.reports.reportsReady ? (
            <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
              <p className="text-sm font-semibold text-amber-950">Contingencia de PMS</p>
              <p className="mt-1 text-xs text-amber-900">
                El hotel no puede quedar sin Supervisión porque el PMS o un informe no esté disponible.
                Si debes iniciar sin evidencia completa, explica la contingencia; quedará en Auditoría.
              </p>
              <Textarea
                name="reportContingencyReason"
                rows={3}
                minLength={8}
                placeholder="Ej.: PMS sin disponibilidad desde las 07:05; informes pendientes de emisión."
              />
            </div>
          ) : null}

          {!opening.cashReady ? (
            <p className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-900 ring-1 ring-red-200">
              Caja/garantías todavía no están conformes. Este control sí es bloqueante.
            </p>
          ) : null}

          <div className="flex justify-end">
            <SubmitButton variant="gold" pendingLabel="Confirmando apertura…" disabled={!opening.cashReady}>
              CONFIRMAR E INICIAR TURNO
            </SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </section>
  );
}
