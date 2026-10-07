import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { requirePagePermission } from '@/server/auth/guard';
import { getReceptionOperationGate } from '@/server/services/reception-operation-gate';
import { outstandingAmount } from '@/domain/guarantees';
import { Card, CardHeader } from '@/components/ui/card';
import { EditCashGuaranteeForm, ChargeCashGuaranteeForm, ReturnCashGuaranteeForm } from '@/components/cash/live-cash-forms';
import { formatDateTime, toDateTimeInput } from '@/lib/format';
export const dynamic = 'force-dynamic';
export default async function GuaranteePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission('cash.view');
  const { id } = await params;
  const [g, gate] = await Promise.all([
    prisma.guarantee.findFirst({ where: { id, deletedAt:null, ...(user.isSystemAdmin ? {} : {isDemo:false}) }, include: {settlements:{include:{createdBy:{select:{name:true}}},orderBy:{createdAt:'desc'}}} }),
    getReceptionOperationGate(user),
  ]);
  if(!g) notFound();
  const balance = outstandingAmount({ amount:Number(g.amount), appliedAmount:Number(g.appliedAmount??0), penaltyAmount:Number(g.penaltyAmount??0), returnedAmount:Number(g.returnedAmount??0) });
  const open = ['PENDIENTE','VIGENTE','APLICADA_PARCIALMENTE'].includes(g.state);
  return <div className="mx-auto max-w-4xl space-y-4">
    <Link href="/supervision">Volver al Centro de Supervisión</Link>
    <Card><CardHeader title={`Garantía #${g.humanId} · ${g.reference ?? g.guestName ?? 'Sin referencia'}`} />
      <div className="space-y-3 p-4">
        <p>Huésped: {g.guestName ?? '—'} · Habitación: {g.roomNumber ?? '—'}</p>
        <p>Estado: {g.state} · {g.currency} {balance.toLocaleString('es-CL')} pendientes</p>
        <p>Fecha objetivo: {formatDateTime(g.dueAt)} · Creada: {formatDateTime(g.createdAt)}</p>
        {g.notes ? <p>{g.notes}</p> : null}
        {g.kind === 'EFECTIVO' && open && gate.mode === 'ACTIVE' ? <div className="flex flex-wrap gap-2">
          {user.permissions.includes('cash.guarantee_in') ? <EditCashGuaranteeForm guaranteeId={g.id} humanId={g.humanId} currency={g.currency} amount={Number(g.amount)} guestName={g.guestName} roomNumber={g.roomNumber} reference={g.reference} dueAt={g.dueAt?toDateTimeInput(g.dueAt):''} notes={g.notes} /> : null}
          {user.permissions.includes('cash.guarantee_out') ? <><ChargeCashGuaranteeForm guaranteeId={g.id} requestKey={randomUUID()} humanId={g.humanId} reference={g.reference??g.guestName} currency={g.currency} amount={balance} guestName={g.guestName} roomNumber={g.roomNumber} /><ReturnCashGuaranteeForm guaranteeId={g.id} requestKey={randomUUID()} reference={g.reference??g.guestName} currency={g.currency} amount={balance} guestName={g.guestName} roomNumber={g.roomNumber} /></> : null}
        </div> : null}
      </div>
    </Card>
    <Card><CardHeader title="Liquidaciones del registro" /><ul className="space-y-2 p-4">{g.settlements.map(s=><li key={s.id}>{s.kind} · {s.currency} {Number(s.amount).toLocaleString('es-CL')} · {s.reason} · {s.createdBy.name} · {formatDateTime(s.createdAt)}</li>)}</ul></Card>
  </div>;
}
