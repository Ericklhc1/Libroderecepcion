import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireHousekeepingPageUser } from '@/server/auth/housekeeping';
import { getHousekeepingBoard, getHousekeepingSources, housekeepingSourceChanged } from '@/server/services/housekeeping';
import { HOUSEKEEPING_LABELS, HOUSEKEEPING_ACTION_LABELS, housekeepingActions, isHousekeepingClosed, type HousekeepingStatus, type HousekeepingAction } from '@/domain/housekeeping';
import { formatDateTime } from '@/lib/format';
import { StatTile } from '@/components/ui/card';
import { HousekeepingChangeForm, LinkHousekeepingForm, NewHousekeepingForm } from '@/components/admin/housekeeping-forms';

export const metadata = { title: 'Housekeeping · piloto privado' };
export const dynamic = 'force-dynamic';

export default async function HousekeepingPage({ searchParams }: { searchParams: Promise<{ vista?: string; q?: string; pagina?: string; aviso?: string }> }) {
  const user = await requireHousekeepingPageUser();
  const params = await searchParams;
  const history = params.vista === 'historial';
  const [board, sources] = await Promise.all([getHousekeepingBoard(user, history, Number(params.pagina ?? 1), params.aviso ? Number(params.aviso) : undefined), history ? Promise.resolve([]) : getHousekeepingSources(user, params.q)]);
  return <div className="mx-auto max-w-6xl space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold text-petrol-900">Housekeeping</h1><p className="text-sm text-slate-600">Coordinación, confirmación y continuidad entre áreas.</p></div><NewHousekeepingForm requestKey={randomUUID()} /></header>
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><strong>Piloto privado · solo Administrador de sistema.</strong> Todos los avisos y confirmaciones son pruebas administrativas. No se envían al personal ni acreditan trabajo realizado por Housekeeping. Los pendientes permanecen visibles hasta resolverlos o cancelarlos.</div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><StatTile label="Pendientes activos" value={board.active} /><StatTile label="Sin primera recepción" value={board.pending} /><StatTile label="Bloqueados" value={board.blocked} /><StatTile label="Plazo vencido" value={board.overdue} /></div>
    <nav className="flex gap-3 text-sm" aria-label="Vistas de Housekeeping"><Link className={!history ? 'font-semibold underline' : ''} href="/admin/housekeeping">Pendientes</Link><Link className={history ? 'font-semibold underline' : ''} href="/admin/housekeeping?vista=historial">Resueltos y cancelados</Link></nav>
    <section className="space-y-3" aria-label={history ? 'Historial' : 'Avisos pendientes'}>
      {board.requests.length === 0 && <div className="card p-6 text-center text-sm text-slate-600">{history ? 'Todavía no hay avisos finalizados.' : 'No hay pendientes de Housekeeping en el piloto.'}</div>}
      {board.requests.map((request) => {
        const status = request.status as HousekeepingStatus;
        const sourceChanged = housekeepingSourceChanged(request);
        const overdue = !!request.dueAt && request.dueAt < new Date() && !isHousekeepingClosed(status);
        const actions = request.sourceEntry?.deletedAt ? housekeepingActions(status, sourceChanged).filter((action) => action === 'CANCELAR' || action === 'REABRIR') : housekeepingActions(status, sourceChanged);
        return <article className="card space-y-3 p-4" key={request.id} id={`aviso-${request.humanId}`}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold text-petrol-900">#{request.humanId} · {request.sourceEntry?.title ?? request.title}</h2><p className="text-xs text-slate-600">{request.location ?? request.sourceEntry?.room?.number ?? 'Sin ubicación específica'} · Prioridad {request.priority.toLowerCase()} · {HOUSEKEEPING_LABELS[status]}</p></div>{overdue && <span className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Plazo vencido</span>}</div>
          <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{request.sourceEntry?.description ?? request.description}</p>
          {request.sourceEntry && <p className="text-xs text-slate-600">Origen: <Link className="underline" href={`/libro/${request.sourceEntry.id}`}>Novedad #{request.sourceEntry.humanId}</Link> · Su estado se conserva independiente de esta prueba.</p>}
          {sourceChanged && !isHousekeepingClosed(status) && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">La novedad cambió después de confirmar. Revisa su contenido y vuelve a confirmar antes de continuar.</p>}
          {request.sourceEntry?.deletedAt && <p className="text-sm text-red-800">El origen fue archivado. Conserva este historial y cancela el pendiente con motivo si corresponde.</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"><span>Recepción: {request.acknowledgedAt ? formatDateTime(request.acknowledgedAt) : 'Sin confirmar'}</span><span>Plazo: {request.dueAt ? formatDateTime(request.dueAt) : 'Sin plazo'}</span>{request.resolvedAt && <span>Finalización: {formatDateTime(request.resolvedAt)}</span>}</div>
          {request.blockReason && <p className="text-sm text-amber-900"><strong>Impedimento:</strong> {request.blockReason}</p>}
          {request.resolution && <p className="text-sm text-green-800"><strong>Resultado registrado:</strong> {request.resolution}</p>}
          <div className="flex flex-wrap gap-2">{actions.map((action) => <HousekeepingChangeForm key={action} id={request.id} version={request.version} action={action} />)}</div>
          <details className="border-t border-slate-100 pt-2"><summary className="cursor-pointer text-xs text-slate-600">Historial de prueba · últimos 20 movimientos</summary><ol className="mt-2 space-y-2 text-xs text-slate-600">{request.events.map((event) => <li key={event.id}><strong>{event.actor.name}</strong> · {event.action === 'CREAR' ? 'Aviso creado' : HOUSEKEEPING_ACTION_LABELS[event.action as HousekeepingAction]} · {formatDateTime(event.createdAt)}{event.note && <p className="whitespace-pre-wrap break-words">{event.note}</p>}</li>)}</ol></details>
        </article>;
      })}
      {board.total > 25 && <nav className="flex flex-wrap gap-3 text-sm" aria-label="Páginas de avisos"><span>Página {board.page} · {board.total} avisos</span>{board.page > 1 && <Link className="underline" href={`/admin/housekeeping?vista=${history ? 'historial' : 'pendientes'}&pagina=${board.page - 1}`}>Anterior</Link>}{board.page * 25 < board.total && <Link className="underline" href={`/admin/housekeeping?vista=${history ? 'historial' : 'pendientes'}&pagina=${board.page + 1}`}>Siguiente</Link>}</nav>}
    </section>
    {!history && <section className="card space-y-3 p-4"><h2 className="font-semibold text-petrol-900">Vincular una novedad existente</h2><p className="text-sm text-slate-600">Selecciona únicamente lo que Housekeeping deba conocer o atender. El contenido se consulta desde el registro original; vincularlo no cambia su estado ni envía notificaciones.</p>
      <form action="/admin/housekeeping" className="flex flex-wrap gap-2"><input aria-label="Buscar novedad por número, habitación o título" className="input-base min-w-0 flex-1" name="q" defaultValue={params.q ?? ''} placeholder="#ID, habitación o título" maxLength={100} /><button className="btn btn-secondary" type="submit">Buscar</button></form>
      {sources.length === 0 && <p className="text-sm text-slate-500">No hay novedades abiertas sin vincular para esta búsqueda.</p>}
      <ul className="divide-y divide-slate-100">{sources.map((source) => <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><Link href={`/libro/${source.id}`} className="min-w-0 break-words text-sm text-petrol-800">#{source.humanId} · {source.title}{source.room && ` · ${source.room.number}`}</Link><LinkHousekeepingForm sourceEntryId={source.id} requestKey={randomUUID()} /></li>)}</ul>
    </section>}
  </div>;
}
