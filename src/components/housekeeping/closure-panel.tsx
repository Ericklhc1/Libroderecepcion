import Link from 'next/link';
import type { CurrentUser } from '@/server/auth/current-user';
import { getHkClosureHandovers } from '@/server/services/housekeeping-work';
import { formatDateTime } from '@/lib/format';
import { ClosureEvidence } from '@/components/operational/closure-evidence';
import { AcceptHandoverForm, ReceiveHandoverForm } from './work-forms';

export async function HousekeepingClosurePanel({ user }: { user: CurrentUser }) {
  const handovers = await getHkClosureHandovers(user);
  return <div className="mx-auto max-w-4xl space-y-4">
    <header><h1 className="text-xl font-semibold text-petrol-900">Finalización de Housekeeping</h1><p className="mt-2 text-sm text-slate-600">Gracias por el trabajo compartido. Revisa las entregas existentes y confirma únicamente las que recibas realmente.</p></header>
    {!handovers.length && <p className="card p-4 text-sm text-slate-600">No hay relevos pendientes de recepción dentro de tu alcance vigente. Los trabajos y su historial se conservan.</p>}
    {handovers.map(handover => <article key={handover.id} className="card space-y-3 p-4"><h2 className="font-semibold">{handover.department.name} · {handover.createdBy.name}</h2><p className="text-xs text-slate-500">{formatDateTime(handover.createdAt)} · Día {handover.workDate}</p><p className="whitespace-pre-wrap text-sm">{handover.note}</p><details><summary className="cursor-pointer text-sm font-medium">Revisar pendientes y llaves entregados</summary><div className="mt-3 text-sm"><ClosureEvidence value={handover.snapshot} /></div></details>
      {handover.receivedAt ? handover.receivedById ? <><p className="text-sm text-emerald-800">Recibido por {handover.receivedBy?.name} · {formatDateTime(handover.receivedAt)}</p>{!handover.acceptedAt && handover.receivedById === user.id && <AcceptHandoverForm id={handover.id} />}</> : <p className="text-sm text-amber-800">La recepción histórica carece de una persona identificada. Administración debe revisar la evidencia antes del bloqueo final.</p> : handover.createdById !== user.id ? <ReceiveHandoverForm id={handover.id} /> : <p className="text-sm text-amber-800">Pendiente de recepción por otra persona autorizada. No puedes recibir tu propia entrega.</p>}
    </article>)}
    <Link href="/jornada" className="inline-block text-sm underline">Revisar cierre de mi jornada</Link><br />
    <Link href="/turno" className="inline-block text-sm underline">Volver al cierre de la operación</Link>
  </div>;
}
