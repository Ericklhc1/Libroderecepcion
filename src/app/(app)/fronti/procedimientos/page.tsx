import Link from 'next/link';
import { executionStatus } from '@/domain/fronti-execution';
import { executionActor, readExecution } from '@/server/ai/execution/service';
import { FRONTI_ACTIONS } from '@/server/ai/execution/catalog';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export default async function ProceduresPage({ searchParams }: { searchParams: Promise<{ ejecucion?: string }> }) {
  const user = await executionActor();
  const { ejecucion } = await searchParams;
  const detail = ejecucion ? await readExecution(ejecucion) : null;
  const recent = await prisma.frontiExecution.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 25, select: { id: true, authorizedAt: true, cancelledAt: true, steps:{select:{status:true}}, createdAt: true } });
  const label: Record<string,string> = { PREPARED:'Por autorizar', AUTHORIZED:'Autorizado', SUCCEEDED:'Completado', PARTIAL:'Parcial / en curso', INTERVENTION:'Requiere revisión', CANCELLED:'Cancelado', RUNNING:'En curso', PENDING:'Pendiente', CHANGED:'El registro cambió' };
  return <div className="mx-auto max-w-5xl space-y-5">
    <header><h1 className="text-xl font-semibold">Procedimientos de Fronti</h1><p className="text-sm text-slate-600">Tu autorización, tus permisos y un resultado por cada paso. Los datos físicos deben haber sido comprobados por ti.</p></header>
    <Link href="/coordinacion" className="underline">Volver a Coordinación</Link>
    {detail && <section className="card space-y-3 p-4"><h2 className="font-semibold">Resultado: {label[detail.status] ?? detail.status}</h2><p className="text-sm">{formatDateTime(detail.createdAt)}</p><ol className="space-y-2">{detail.steps.map((step,i)=><li key={i}>{i+1}. {FRONTI_ACTIONS.find(a=>a.name===step.action)?.label ?? 'Procedimiento'}: {label[step.status] ?? step.status}{step.result && typeof step.result==='object' && 'message' in step.result ? <p className="text-sm text-slate-600">{String(step.result.message)}</p> : null}{step.result && typeof step.result==='object' && 'href' in step.result && typeof step.result.href==='string' && /^\/(tareas|libro)\//.test(step.result.href) ? <Link className="block text-sm underline" href={step.result.href}>Abrir registro original</Link> : null}{step.startedAt && <p className="text-xs text-slate-500">Inicio: {formatDateTime(step.startedAt)}{step.completedAt ? ` · Fin: ${formatDateTime(step.completedAt)} · Duración registrada: ${step.completedAt.getTime()-step.startedAt.getTime()} ms` : ' · Sin resultado final registrado'}</p>}</li>)}</ol><p className="text-sm">Puedes consultar o cancelar los pasos pendientes escribiendo en Fronti: /estado {detail.id} o /cancelar {detail.id}. Cancelar no revierte pasos realizados.</p></section>}
    <section className="card p-4"><h2 className="font-semibold">Tus últimas 25 solicitudes</h2>{recent.length ? <ul className="space-y-2">{recent.map(r=><li key={r.id}><Link className="underline" href={`?ejecucion=${r.id}`}>{formatDateTime(r.createdAt)} · {label[executionStatus(r)]??executionStatus(r)}</Link></li>)}</ul>:<p>No hay procedimientos registrados.</p>}</section>
    <section className="card p-4"><h2 className="font-semibold">Procedimientos conectados</h2><p className="mb-3 text-sm text-amber-800">En validación. La lista de adaptadores no acredita todavía todos los recorridos. Los controles del formulario original se mantienen.</p><ul className="grid gap-2 sm:grid-cols-2">{FRONTI_ACTIONS.map(a=><li key={a.name} className="rounded border p-2 text-sm">{a.label}{a.physical&&<span className="block text-xs text-slate-600">Requiere hechos declarados por una persona.</span>}</li>)}</ul></section>
  </div>;
}
