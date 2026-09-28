import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import { PrintButton } from '@/components/operational/handover-notes';

export const metadata = { title: 'Imprimir arqueo' };
export const dynamic = 'force-dynamic';

type DenominationSnapshot = {
  id: string;
  value: number;
  medium: string;
  quantity: number;
  subtotal: number;
};

type GuaranteeSnapshot = {
  id: string;
  currency: string;
  amount: number;
  state: string;
  reference: string | null;
  roomNumber: string | null;
  guestName: string | null;
};

function amount(currency: string, value: number) {
  return `${currency} ${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`;
}

function denominationRows(value: unknown): DenominationSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is DenominationSnapshot => {
    if (!row || typeof row !== 'object') return false;
    const item = row as Record<string, unknown>;
    return (
      typeof item.value === 'number' &&
      typeof item.quantity === 'number' &&
      typeof item.subtotal === 'number' &&
      typeof item.medium === 'string'
    );
  });
}

function guaranteeRows(value: unknown): GuaranteeSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is GuaranteeSnapshot => {
    if (!row || typeof row !== 'object') return false;
    const item = row as Record<string, unknown>;
    return typeof item.amount === 'number' && typeof item.currency === 'string';
  });
}

export default async function CashAuditPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission('cash.view');
  const { id } = await params;

  const audit = await prisma.cashAudit.findUnique({
    where: { id },
    include: { countedBy: { select: { name: true } } },
  });
  if (!audit) notFound();

  const denominations = denominationRows(audit.denominationSnapshot).filter((row) => row.quantity > 0);
  const guarantees = guaranteeRows(audit.guaranteeSnapshot);
  const expected = Number(audit.expectedAmount);
  const counted = Number(audit.countedAmount);
  const difference = Number(audit.difference);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Link href="/caja?seccion=auditorias" className="inline-flex items-center gap-1 text-sm font-medium text-petrol-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver a Caja
        </Link>
        <PrintButton label="Imprimir arqueo" />
      </div>

      <article className="print-report rounded-xl border border-slate-200 bg-white p-6 print:border-0 print:p-0">
        <header className="border-b border-slate-300 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Libro Operativo de Recepción</p>
          <h1 className="mt-1 text-2xl font-semibold text-petrol-900">Arqueo de Caja #{audit.humanId}</h1>
          <div className="mt-3 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
            <p><span className="font-semibold text-slate-800">Divisa:</span> {audit.currency}</p>
            <p><span className="font-semibold text-slate-800">Fecha:</span> {formatDateTime(audit.createdAt)}</p>
            <p><span className="font-semibold text-slate-800">Realizado por:</span> {audit.countedBy.name}</p>
            <p>
              <span className="font-semibold text-slate-800">Resultado:</span>{' '}
              {difference === 0 ? 'Cuadra' : `Diferencia ${difference > 0 ? '+' : ''}${amount(audit.currency, difference)}`}
            </p>
          </div>
        </header>

        <section className="mt-5">
          <h2 className="text-base font-semibold text-petrol-900">Resumen del fondo fijo</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Esperado</p>
              <p className="mt-1 text-lg font-semibold tabular">{amount(audit.currency, expected)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Contado</p>
              <p className="mt-1 text-lg font-semibold tabular">{amount(audit.currency, counted)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Diferencia</p>
              <p className="mt-1 text-lg font-semibold tabular">{difference > 0 ? '+' : ''}{amount(audit.currency, difference)}</p>
            </div>
          </div>
        </section>

        <section className="mt-5">
          <h2 className="text-base font-semibold text-petrol-900">Desglose por denominación</h2>
          {denominations.length === 0 ? (
            <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Este arqueo no conserva desglose por denominación. Los arqueos registrados antes de esta versión mantienen sus totales históricos, pero no pueden reconstruir cantidades que nunca fueron guardadas.
            </p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="border-y border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Medio</th>
                  <th className="py-2 pr-3">Denominación</th>
                  <th className="py-2 pr-3 text-right">Cantidad</th>
                  <th className="py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {denominations.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3">{row.medium === 'MONEDA' ? 'Moneda' : 'Billete'}</td>
                    <td className="py-2 pr-3 tabular">{amount(audit.currency, row.value)}</td>
                    <td className="py-2 pr-3 text-right tabular">{row.quantity}</td>
                    <td className="py-2 text-right tabular">{amount(audit.currency, row.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="mt-5">
          <h2 className="text-base font-semibold text-petrol-900">Garantías validadas físicamente</h2>
          {guarantees.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No había garantías en efectivo vigentes para validar.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead className="border-y border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Referencia</th>
                  <th className="py-2 pr-3">Habitación</th>
                  <th className="py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {guarantees.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3">{row.guestName || row.reference || 'Garantía sin referencia'}</td>
                    <td className="py-2 pr-3">{row.roomNumber || '—'}</td>
                    <td className="py-2 text-right tabular">{amount(row.currency, row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {audit.notes ? (
          <section className="mt-5 border-t border-slate-300 pt-4">
            <h2 className="text-sm font-semibold text-petrol-900">Observaciones</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{audit.notes}</p>
          </section>
        ) : null}

        <footer className="mt-10 grid gap-8 border-t border-slate-300 pt-8 text-center text-xs text-slate-500 sm:grid-cols-2">
          <div className="border-t border-slate-500 pt-2">Firma de quien realiza el arqueo</div>
          <div className="border-t border-slate-500 pt-2">Firma de validación / recepción</div>
        </footer>
      </article>
    </div>
  );
}
