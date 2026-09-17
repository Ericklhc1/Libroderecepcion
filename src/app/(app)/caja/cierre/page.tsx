import Link from 'next/link';
import { Banknote, CheckCircle2, LockKeyhole, RotateCcw } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { ROLE_KEYS } from '@/lib/permissions';
import { getMyOpenShift, getCurrentShift } from '@/server/services/shifts';
import { getShiftCashClosure } from '@/server/services/cash-closure';
import { getLiveCashState } from '@/server/services/live-cash';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { closeShiftCashAction, reopenShiftCashAction } from '@/server/actions/cash-closure';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Cierre de Caja' };
export const dynamic = 'force-dynamic';

function money(currency: string, value: number) {
  return `${currency} ${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`;
}

export default async function CashClosurePage() {
  const user = await requirePagePermission('shift.handover');
  const shift = (await getMyOpenShift(user.id)) ?? (hasPermission(user, 'shift.manage') ? await getCurrentShift() : null);

  if (!shift) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <header>
          <h1 className="text-xl font-semibold text-petrol-900">Cierre de Caja</h1>
          <p className="mt-1 text-sm text-slate-600">Caja se cierra antes del cierre del turno.</p>
        </header>
        <Card><EmptyState message="No hay un turno operativo que cerrar." /></Card>
        <Link href="/caja" className="text-sm font-medium text-petrol-600 hover:underline">Volver a Caja</Link>
      </div>
    );
  }

  const [closure, cash] = await Promise.all([
    getShiftCashClosure(shift.id),
    getLiveCashState(100),
  ]);
  const activeClosure = closure && !closure.reopenedAt ? closure : null;
  const canReopen = user.roleKey === ROLE_KEYS.SUPERVISOR || user.isSystemAdmin;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
            <LockKeyhole className="h-5 w-5 text-petrol-600" aria-hidden="true" />
            Cierre de Caja
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Este cierre es independiente y obligatorio: primero se cuadra Caja y después se puede enviar o cerrar el turno.
          </p>
        </div>
        <Badge tone={activeClosure ? 'resuelto' : 'pendiente'}>{activeClosure ? 'Caja cerrada' : 'Pendiente'}</Badge>
      </header>

      <Card>
        <CardHeader title="Fotografía actual" count={cash.currencies.length} />
        {cash.currencies.length === 0 ? (
          <EmptyState message="No hay divisas activas en Caja." hint="Puedes cerrar Caja igualmente; quedará registrada como una Caja sin efectivo operativo." />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {cash.currencies.map((currency) => {
              const audit = cash.audits.find((row) => row.currency === currency.currency);
              return (
                <div key={currency.currency} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-petrol-900">{currency.currency}</p>
                    <Banknote className="h-4 w-4 text-petrol-600" aria-hidden="true" />
                  </div>
                  <p className="mt-1 text-lg font-semibold tabular text-petrol-900">{money(currency.currency, currency.expected)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {audit
                      ? `Último conteo: ${money(currency.currency, audit.countedAmount)} · diferencia ${audit.difference > 0 ? '+' : ''}${audit.difference}`
                      : 'Sin auditoría visible todavía.'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
          Si una divisa no fue auditada durante este turno, o tiene diferencia, el servidor impedirá cerrar Caja.{' '}
          <Link href="/caja" className="font-medium text-petrol-600 hover:underline">Auditar / reconciliar en Caja</Link>
        </div>
      </Card>

      {activeClosure ? (
        <Card className="border-emerald-300">
          <div className="flex items-start gap-3 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-petrol-900">Caja confirmada</h2>
              <p className="mt-1 text-sm text-slate-600">
                Cerró {activeClosure.closedByName} · {formatDateTime(activeClosure.closedAt)}. El turno puede continuar a su entrega.
              </p>
              {activeClosure.notes ? <p className="mt-1 text-sm text-slate-600">{activeClosure.notes}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/turno" className="rounded-lg bg-petrol-700 px-3 py-2 text-sm font-semibold text-white hover:bg-petrol-800">Continuar al turno</Link>
                {canReopen ? (
                  <ActionForm action={reopenShiftCashAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="shiftId" value={shift.id} />
                    <Field label="Motivo de reapertura" name="reason" required>
                      <Textarea name="reason" rows={1} minLength={5} required placeholder="Corrección necesaria" />
                    </Field>
                    <SubmitButton variant="danger" pendingLabel="Reabriendo…">
                      <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reabrir Caja
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Confirmar cierre" />
          <ActionForm action={closeShiftCashAction} className="space-y-3 p-4">
            <input type="hidden" name="shiftId" value={shift.id} />
            <Field label="Observación de cierre" name="notes" hint="Opcional. Queda congelada junto con la fotografía de Caja.">
              <Textarea name="notes" rows={3} maxLength={1000} placeholder="Ej.: cuadratura revisada sin diferencias" />
            </Field>
            <SubmitButton pendingLabel="Cerrando Caja…">Cerrar Caja y bloquear saldos del turno</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
