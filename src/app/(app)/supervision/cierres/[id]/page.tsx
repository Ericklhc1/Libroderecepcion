import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePageUser } from '@/server/auth/guard';
import { assertClosureReviewer, legacyClosureAlertWhere, closureReviewState } from '@/server/services/closure-review';
import { ClosureReviewForm } from '@/components/supervision/closure-review-form';
import { Card, CardHeader } from '@/components/ui/card';
import { HistoryTimeline } from '@/components/operational/history-timeline';
import { getHistory } from '@/server/services/history';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
export const dynamic = 'force-dynamic';
export default async function ClosureReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser(); assertClosureReviewer(user);
  const { id } = await params;
  const shift = await prisma.shift.findUnique({ where: { id }, include: { handoverOut: { include: { issuedBy: { select: { name: true } }, receivedBy: { select: { name: true } } } } } });
  if (!shift || (shift.isDemo && !user.isSystemAdmin)) notFound();
  const [history, legacy] = await Promise.all([getHistory({ entity: 'Shift', entityId: id }, user), prisma.alert.findFirst({where:legacyClosureAlertWhere(id),select:{status:true,resolutionNote:true}})]);
  const {decision,pending}=closureReviewState(shift,legacy);
  return <div className="mx-auto max-w-5xl space-y-4">
    <Link href="/supervision?seccion=atencion">Volver al Centro de Supervisión</Link>
    <Card><CardHeader title={`Cierre #${shift.humanId} · ${shift.type} · ${formatCalendarDate(shift.date)}`} />
      <div className="space-y-3 p-4">
        <p>Estado: {shift.status} · Cerrado: {formatDateTime(shift.actualEnd)}</p>
        {shift.handoverOut ? <><p>Entrega: {shift.handoverOut.issuedBy.name} · Recibe: {shift.handoverOut.receivedBy?.name ?? 'Sin confirmar'}</p><Link className="inline-block font-semibold underline" href={`/turno/entrega/${shift.handoverOut.id}`}>Abrir entrega, Caja, garantías y custodia de este cierre</Link></> : <p>Sin entrega vinculada.</p>}
        <p>Revisión: {decision}</p>
        {shift.closureReviewNote ? <p>{shift.closureReviewNote}</p> : null}
        {shift.status === 'CERRADO' && !shift.archivedAt && pending ? <ClosureReviewForm shiftId={id} revision={shift.updatedAt.toISOString()} /> : null}
      </div>
    </Card>
    <Card><CardHeader title="Auditoría del cierre" /><HistoryTimeline events={history} /></Card>
  </div>;
}
