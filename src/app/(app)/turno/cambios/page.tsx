import Link from 'next/link';
import { requirePageUser } from '@/server/auth/guard';
import { getChangesSinceLastShift } from '@/server/services/shift-changes';
import { formatDateTime } from '@/lib/format';
import { Card, CardHeader } from '@/components/ui/card';
export const metadata = {title:'Qué cambió desde mi último turno'};
export const dynamic = 'force-dynamic';
export default async function ShiftChangesPage({searchParams}:{searchParams:Promise<{pagina?:string}>}) {
  const user=await requirePageUser({allowAreaOperation:true});
  const params=await searchParams;
  const data=await getChangesSinceLastShift(user,Number(params.pagina??1));
  const hasNext=data.groups.some(group=>group.total>data.page*data.pageSize);
  return <div className="mx-auto max-w-5xl space-y-4">
    <header><Link href="/turno" className="text-sm underline">Mi turno</Link><h1 className="mt-2 text-xl font-semibold text-petrol-900">Qué cambió desde mi último turno</h1>
      <p className="mt-1 text-sm text-slate-600">Responsables actuales, resultados y pendientes nuevos, con su registro fuente. Resumen de datos guardados, sin análisis de IA.</p></header>
    {!data.baseline ? <Card><p className="p-4 text-sm text-slate-600">No hay un fin de participación o cierre de Supervisión anterior registrado para tu cuenta. Los horarios programados no acreditan un turno trabajado. Puedes consultar <Link href="/coordinacion" className="underline">los pendientes actuales</Link>.</p></Card> : <>
      <p className="text-sm text-slate-600">Desde {formatDateTime(data.baseline.at)} ({data.baseline.label}) hasta {formatDateTime(data.now)} · America/Santiago. Sólo registros que puedes consultar; cada fuente aparece una vez en su sección.</p>
      {data.groups.filter(group=>group.total>0).map(group=><Card key={group.key}><CardHeader title={`${group.label} · ${group.total} actualizados`} /><div className="px-4 py-3">
        <p className="mb-3 text-xs text-slate-500">Página {data.page} · hasta {data.pageSize} registros por sección.</p>
        {group.items.length===0 ? <p className="text-sm text-slate-500">Esta sección no tiene más registros en esta página.</p> : <ul className="divide-y divide-slate-100">{group.items.map(item=><li key={item.id} className="space-y-1 py-3">
          <Link href={item.href} className="font-medium text-petrol-800 underline">#{item.humanId} · {item.title}</Link>
          <p className="text-sm text-slate-700">{item.labels.join(' · ')}. Responsable: {item.owner}. Estado: {item.status}.</p>
          {item.result&&<p className="whitespace-pre-wrap text-sm text-slate-600">{item.resultLabel}: {item.result}</p>}
          <p className="text-xs text-slate-500">Actualizado {formatDateTime(item.updatedAt)}</p>
        </li>)}</ul>}
      </div></Card>)}
      {data.groups.every(group=>group.total===0)&&<p className="rounded-md bg-slate-50 p-4 text-sm">No hay cambios visibles desde ese turno.</p>}
      <nav aria-label="Páginas de cambios" className="flex gap-4">{data.page>1&&<Link href={`/turno/cambios?pagina=${data.page-1}`} className="underline">Anterior</Link>}{hasNext&&<Link href={`/turno/cambios?pagina=${data.page+1}`} className="underline">Siguiente</Link>}</nav>
    </>}
  </div>;
}
