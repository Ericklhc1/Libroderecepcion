import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePageAnyPermission } from '@/server/auth/guard';
import { PrintButton } from '@/components/operational/handover-notes';
import { formatDateTime } from '@/lib/format';
export const dynamic = 'force-dynamic';
export default async function StaffLoanReceipt({ params }: { params: Promise<{id:string}> }) {
  await requirePageAnyPermission(['key.assign','key.inventory','key.stock']);
  const {id} = await params;
  const loan = await prisma.keyStaffLoan.findUnique({ where:{id},include:{items:true} });
  if (!loan) notFound();
  return <><div className="no-print mb-4 flex justify-between"><Link className="underline" href="/llaves/personal">Volver a entregas</Link><PrintButton label="Imprimir entrega" /></div><article className="print-report rounded border bg-white p-5"><h1 className="text-xl font-semibold">Entrega de llaves a personal #{loan.humanId}</h1><p>{formatDateTime(loan.createdAt)} · Área: {loan.departmentName}</p><p>Colaborador: {loan.collaboratorName ?? 'Personal del área · sin nombre individual'}</p><p>Autorización informada: {loan.authorizedByName}</p><p>Registró la entrega: {loan.createdByName}</p>{loan.notes && <p>{loan.notes}</p>}<table className="my-4 w-full text-sm"><thead><tr>{['Llave','Destino','Recepción / devolución'].map(t => <th className="border p-2 text-left" key={t}>{t}</th>)}</tr></thead><tbody>{loan.items.map(i => <tr key={i.id}><td className="border p-2">{i.keyCode}</td><td className="border p-2">{i.destinationName}</td><td className="border p-2">{i.returnedAt ? `${formatDateTime(i.returnedAt)} · ${i.returnNote}` : 'En custodia del personal'}</td></tr>)}</tbody></table><div className="mt-8 grid grid-cols-2 gap-8"><p className="border-t pt-2">Firma de quien recibe</p><p className="border-t pt-2">Firma de quien autoriza</p></div></article></>;
}
