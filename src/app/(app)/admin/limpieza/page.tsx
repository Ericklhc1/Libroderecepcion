import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePageUser } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';
import { cleanupKinds, type CleanupKind } from '@/server/services/admin-cleanup';
import { CleanupDialog } from './cleanup-dialog';

export const metadata = { title: 'Limpiar datos de prueba' };
export const dynamic = 'force-dynamic';
const labels: Record<CleanupKind, string> = { fronti: 'Mensajes de Fronti privado', frontiChat: 'Mensajes de Fronti en Chat', notification: 'Notificaciones', cashMovement: 'Movimientos de Caja', cashAudit: 'Arqueos de Caja', housekeeping: 'Trabajos HK' };
export default async function CleanupPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requirePageUser({ allowAreaOperation: true });
  if (!user.isSystemAdmin) redirect('/sin-permisos');
  const params = await searchParams;
  const kind = cleanupKinds.includes(params.tipo as CleanupKind) ? params.tipo as CleanupKind : 'fronti';
  const page = Math.max(1, Math.min(10000, Number(params.pagina) || 1));
  const q = typeof params.q === 'string' ? params.q.trim().slice(0,200) : '';
  const match = q ? { contains: q, mode: 'insensitive' as const } : undefined;
  const pagination = { take: 51, skip: (page - 1) * 50 };
  let rows: Array<{ id: string; label: string; revision: string; at: Date }>;
  switch (kind) {
    case 'fronti': rows = (await prisma.ai_message.findMany({ where: { deletedAt: null, ...(match ? { OR: [{content:match},{id:match}] } : {}) }, orderBy:[{created_at:'desc'},{id:'asc'}], ...pagination })).map(r=>({id:r.id,label:`${r.role}: ${r.content.slice(0,240)}`,revision:r.created_at.toISOString(),at:r.created_at})); break;
    case 'frontiChat': rows = (await prisma.chatMessage.findMany({ where: { deletedAt:null, AND:[{OR:[{author:'FRONTI'},{conversation:{type:'FRONTI'}}]},...(match?[{OR:[{body:match},{id:match}]}]:[])] }, orderBy:[{createdAt:'desc'},{id:'asc'}], ...pagination })).map(r=>({id:r.id,label:`${r.author}: ${r.body?.slice(0,240)??'Mensaje'}`,revision:(r.editedAt??r.createdAt).toISOString(),at:r.createdAt})); break;
    case 'notification': rows = (await prisma.notification.findMany({ where:{deletedAt:null,...(match?{OR:[{title:match},{id:match}]}:{})}, orderBy:[{createdAt:'desc'},{id:'asc'}], ...pagination, include:{user:{select:{name:true}}} })).map(r=>({id:r.id,label:`${r.title} · ${r.user.name}`,revision:r.createdAt.toISOString(),at:r.createdAt})); break;
    case 'cashMovement': rows = (await prisma.cashMovement.findMany({ where:{voidedAt:null,...(match?{OR:[{reference:match},{notes:match},{id:match}]}:{})}, orderBy:[{createdAt:'desc'},{id:'asc'}], ...pagination })).map(r=>({id:r.id,label:`#${r.humanId} · ${r.kind} · ${r.amount} ${r.currency}`,revision:r.createdAt.toISOString(),at:r.createdAt})); break;
    case 'cashAudit': rows = (await prisma.cashAudit.findMany({ where:{deletedAt:null,...(match?{OR:[{notes:match},{id:match}]}:{})}, orderBy:[{createdAt:'desc'},{id:'asc'}], ...pagination })).map(r=>({id:r.id,label:`#${r.humanId} · Arqueo ${r.countedAmount} ${r.currency}`,revision:r.createdAt.toISOString(),at:r.createdAt})); break;
    case 'housekeeping': rows = (await prisma.housekeepingRequest.findMany({ where:{deletedAt:null,...(match?{OR:[{title:match},{description:match},{id:match}]}:{})}, orderBy:[{createdAt:'desc'},{id:'asc'}], ...pagination })).map(r=>({id:r.id,label:`#${r.humanId} · ${r.title??r.description?.slice(0,160)??'Trabajo'} · ${r.status}`,revision:String(r.version),at:r.createdAt})); break;
  }
  return <div className="mx-auto max-w-4xl space-y-4">
    <Link href="/admin" className="text-petrol-700 underline">Volver a Administración</Link>
    <h1 className="text-xl font-semibold">Limpiar datos de prueba</h1>
    <p className="text-sm text-slate-600">Sólo SysAdmin. Selecciona cada registro y verifica que sea de prueba antes de confirmar. Se conserva la auditoría; no se borra información físicamente.</p>
    <Link href="/admin/turnos" className="text-petrol-700 underline">Retirar una persona de un turno</Link>
    <form className="flex flex-wrap gap-2">
      <label>Tipo<select className="input-base" name="tipo" defaultValue={kind}>{cleanupKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
      <label>Buscar<input className="input-base" name="q" defaultValue={q}/></label><button className="rounded bg-petrol-800 px-4 py-2 text-white">Buscar</button>
    </form>
    {!rows.length && <p>No hay registros con estos filtros.</p>}
    <ul className="divide-y rounded-lg bg-white">{rows.slice(0,50).map(row=><li key={row.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="min-w-0 flex-1"><p className="break-words">{row.label}</p><p className="text-xs text-slate-500">{formatDateTime(row.at)} · {row.id}</p></div>
      <CleanupDialog kind={kind} id={row.id} revision={row.revision} label={row.label}/>
    </li>)}</ul>
    <div className="flex gap-4">{page>1&&<Link href={`/admin/limpieza?${new URLSearchParams({tipo:kind,q,pagina:String(page-1)})}`}>Anterior</Link>}{rows.length>50&&<Link href={`/admin/limpieza?${new URLSearchParams({tipo:kind,q,pagina:String(page+1)})}`}>Siguiente</Link>}</div>
  </div>;
}
