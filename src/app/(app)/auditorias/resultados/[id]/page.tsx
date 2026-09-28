import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { PrintButton } from '@/components/operational/handover-notes';

export const metadata = { title: 'Resultado de auditoría' };
export const dynamic = 'force-dynamic';

const RESULT_LABEL = {
  PENDIENTE: 'Sin revisar',
  OK: 'Cumple (histórico)',
  CUMPLE: 'Cumple',
  OBSERVACION: 'Observación',
  FALLA: 'Incumplimiento (histórico)',
  INCUMPLIMIENTO: 'Incumplimiento',
  NO_APLICA: 'No aplica',
} as const;

const RESULT_TONE = {
  PENDIENTE: 'neutro',
  OK: 'resuelto',
  CUMPLE: 'resuelto',
  OBSERVACION: 'atencion',
  FALLA: 'critico',
  INCUMPLIMIENTO: 'critico',
  NO_APLICA: 'neutro',
} as const;

export default async function SharedAuditResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;

  const run = await prisma.checklistRun.findFirst({
    where: { id, deletedAt: null, finishedAt: { not: null } },
    include: {
      items: { orderBy: { order: 'asc' } },
      runBy: { select: { name: true } },
    },
  });
  if (!run) notFound();

  const canViewReserved = user.isSystemAdmin || hasPermission(user, 'supervision.audit.reserved');
  const deliveredToUser = canViewReserved
    ? true
    : Boolean(
        await prisma.notification.findFirst({
          where: {
            userId: user.id,
            entity: 'ChecklistRun',
            entityId: run.id,
          },
          select: { id: true },
        }),
      );

  if (!deliveredToUser) redirect('/sin-permisos');

  const failures = run.items.filter(
    (item) => item.result === 'FALLA' || item.result === 'INCUMPLIMIENTO',
  );
  const observations = run.items.filter((item) => item.result === 'OBSERVACION');

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <Link
          href={canViewReserved ? '/supervision/auditorias' : '/'}
          className="inline-flex items-center gap-1 text-sm font-medium text-petrol-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {canViewReserved ? 'Volver a Auditorías sorpresa' : 'Volver al Inicio'}
        </Link>
        <PrintButton label="Imprimir auditoría" />
      </div>

      <article className="print-report rounded-xl border border-slate-200 bg-white print:border-0">
        <header className="border-b border-slate-200 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                Resultado de auditoría
              </p>
              <h1 className="mt-1 text-xl font-semibold text-petrol-900">
                #{run.humanId} · {run.templateName}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Realizada por {run.runBy.name} · {formatDateTime(run.startedAt)}
                {run.finishedAt ? ` → ${formatDateTime(run.finishedAt)}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={failures.length ? 'critico' : observations.length ? 'atencion' : 'resuelto'}>
                {failures.length
                  ? `${failures.length} incumplimiento(s)`
                  : observations.length
                    ? `${observations.length} observación(es)`
                    : 'Sin incumplimientos'}
              </Badge>
            </div>
          </div>
        </header>

        <div className="space-y-5 p-5">
          {run.scope ? (
            <section>
              <h2 className="text-sm font-semibold text-petrol-900">Alcance</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{run.scope}</p>
            </section>
          ) : null}

          {run.sample ? (
            <section>
              <h2 className="text-sm font-semibold text-petrol-900">Muestra revisada</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{run.sample}</p>
            </section>
          ) : null}

          <section className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold text-petrol-900">Resultado</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {run.resultSummary || 'Cierre registrado sin resumen adicional.'}
            </p>
            {run.notes ? (
              <>
                <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Observaciones generales</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{run.notes}</p>
              </>
            ) : null}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-petrol-900">Puntos revisados</h2>
            <ul className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
              {run.items.map((item) => (
                <li key={item.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={RESULT_TONE[item.result]}>{RESULT_LABEL[item.result]}</Badge>
                    <span className="font-medium text-petrol-900">
                      {item.critical ? 'Crítico · ' : ''}
                      {item.text}
                    </span>
                  </div>
                  {item.observation ? (
                    <p className="mt-1 text-sm text-slate-700">{item.observation}</p>
                  ) : null}
                  {item.evidence ? (
                    <p className="mt-1 text-xs text-slate-500">Evidencia: {item.evidence}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </article>
    </div>
  );
}
