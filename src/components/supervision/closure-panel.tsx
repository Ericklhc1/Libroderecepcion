import Link from 'next/link';
import type { CurrentUser } from '@/server/auth/current-user';
import { getSupervisionClosureState } from '@/server/services/supervision-center';
import { getSupervisionData, supervisionAttentionCounts } from '@/server/services/supervision';
import { formatDateTime } from '@/lib/format';
import { ROLE_KEYS } from '@/lib/permissions';
import { ClosureEvidence } from '@/components/operational/closure-evidence';
import { FinishSupervisionShiftForm, ReceiveSupervisionHandoverForm } from './center-actions';
import { CancelSupervisionOpeningDialog } from './cancel-opening';

export async function SupervisionClosurePanel({ user }: { user: CurrentUser }) {
  const allowed = (user.roleKey === ROLE_KEYS.SUPERVISOR || user.roleKey === ROLE_KEYS.SYSTEM_ADMIN) && user.permissions.includes('supervision.shift.manage');
  if (!allowed) return <div className="mx-auto max-w-4xl space-y-3"><h1 className="text-xl font-semibold">Finalización de Supervisión</h1><p>No tienes un turno de Supervisión que puedas gestionar con tus permisos actuales.</p><Link href="/turno" className="underline">Volver al cierre de la operación</Link></div>;
  const data = await getSupervisionClosureState(user);
  const review = data.currentShift?.status !== 'PREPARACION' && data.currentShift ? await getSupervisionData(user) : null;
  const attention = review ? supervisionAttentionCounts(review.blocks) : { critical: 0, pendingClosures: 0 };
  const summary = data.snapshot?.summary && typeof data.snapshot.summary === 'object' && !Array.isArray(data.snapshot.summary) ? data.snapshot.summary : {};
  return <div className="mx-auto max-w-4xl space-y-4">
    <header><h1 className="text-xl font-semibold text-petrol-900">Finalización de Supervisión</h1><p className="mt-2 text-sm text-slate-600">Gracias por el trabajo compartido. Revisa y finaliza tu turno, y confirma las entregas que recibas realmente. No se abrirán turnos nuevos.</p></header>
    <section className="card space-y-3 p-4" aria-label="Mi turno de Supervisión">
      {data.currentShift ? <><h2 className="font-semibold">Turno #{data.currentShift.humanId} · {data.currentShift.status}</h2><p className="text-sm">Iniciado {formatDateTime(data.currentShift.startedAt)}</p>
        {data.currentShift.status === 'PREPARACION' ? <><p className="text-sm text-slate-600">La apertura aún no activó un turno. Cancela esta preparación con su motivo y confirmación.</p><CancelSupervisionOpeningDialog shiftId={data.currentShift.id} /></> : <>
          {review && <details className="space-y-3"><summary className="cursor-pointer font-medium">Revisar señales críticas y cierres</summary>{review.blocks.filter(block => block.tone === 'critico' || ['cierres', 'cierres-validacion'].includes(block.key)).map(block => <section key={block.key} className="mt-3"><h3 className="font-medium">{block.title}</h3><p className="text-xs text-slate-500">{block.hint}</p><ul className="mt-2 space-y-2 text-sm">{block.rows.map(row => <li key={row.id}><strong>{row.ref} · {row.title}</strong>{row.detail && <p className="whitespace-pre-wrap">{row.detail}</p>}{row.meta && <p>{row.meta}</p>}</li>)}</ul></section>)}</details>}
          {data.snapshot && <details><summary className="cursor-pointer font-medium">Revisar auditorías, pendientes y continuidad</summary><div className="mt-3 text-sm"><ClosureEvidence value={data.snapshot} /></div></details>}
          <FinishSupervisionShiftForm finalClosure shiftId={data.currentShift.id} criticalCount={attention.critical + attention.pendingClosures} continuityCount={Number(summary.tasksPending ?? 0) + Number(summary.followUpsOpen ?? 0)} auditPendingCount={Number(summary.dailyAuditPending ?? 0)} />
        </>}
      </> : <p className="text-sm text-slate-600">{data.lastClosedShift ? `Tu turno #${data.lastClosedShift.humanId} ya está finalizado.` : 'No tienes un turno de Supervisión pendiente de cierre.'}</p>}
    </section>
    <section className="card space-y-3 p-4" aria-label="Entregas de Supervisión pendientes"><h2 className="font-semibold">Entregas por recibir · {data.handovers.length}</h2><p className="text-sm text-slate-600">La recepción conserva tu identidad y no abre una jornada nueva. Tu propia entrega debe recibirla otra persona autorizada.</p>
      {data.handovers.map(handover => <article key={handover.id} className="space-y-3 border-t border-slate-200 pt-3"><h3 className="font-medium">Entrega #{handover.humanId} · {handover.issuedBy.name}</h3><p className="text-xs text-slate-500">{formatDateTime(handover.issuedAt)}</p>{handover.note && <p className="whitespace-pre-wrap text-sm">{handover.note}</p>}<details><summary className="cursor-pointer text-sm">Revisar copia conservada</summary><div className="mt-3 text-sm"><ClosureEvidence value={handover.snapshot} /></div></details>{handover.receivedAt ? <p className="text-sm text-amber-800">La recepción histórica carece de una persona identificada. Administración debe revisar la evidencia antes del bloqueo final.</p> : handover.issuedById !== user.id ? <ReceiveSupervisionHandoverForm handoverId={handover.id} /> : <p className="text-sm text-amber-800">Pendiente de recepción por otra persona autorizada.</p>}</article>)}
    </section>
    <Link href="/turno" className="inline-block text-sm underline">Volver al cierre de la operación</Link>
  </div>;
}
